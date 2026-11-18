const format = 'kapron.chat-bundle';
const text = (value, length) => typeof value === 'string' ? value.slice(0, length) : '';
const date = value => {
  const time = typeof value === 'number' ? value * 1000 : Date.parse(value);
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? new Date(time).toISOString() : undefined;
};

export function normalizeLabels(value) {
  return [...new Set(value.filter(label => typeof label === 'string').map(label => label.trim().slice(0, 32)).filter(Boolean))].slice(0, 12);
}

const searchText = value => (typeof value==='string'?value:'').normalize('NFKC').toLocaleLowerCase();
export function findChats(chats, {query = '', folder = '', label = '', status = 'active'} = {}) {
  const terms = searchText(query).trim().split(/\s+/).filter(Boolean);
  return chats.filter(chat => {
    if (status === 'archived' ? !chat.archived : status !== 'all' && chat.archived) return false;
    if (status === 'pinned' && !chat.pinned) return false;
    if (folder && (chat.folder ?? '') !== folder) return false;
    if (label && !chat.labels?.includes(label)) return false;
    const fields = [chat.title, chat.folder ?? '', ...(chat.labels ?? []), ...chat.messages.map(message => message.text)];
    return terms.every(term => fields.some(field => searchText(field).includes(term)));
  }).sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || String(b.updated ?? '').localeCompare(String(a.updated ?? '')));
}

function portableMessage(message) {
  return {
    id:message.id, role:message.role, text:text(message.text, 60000), created:date(message.created),
    model:text(message.model, 160) || undefined, gemName:text(message.gemName, 80) || undefined,
    bookmarked:message.bookmarked === true,
    rating:['helpful','unhelpful'].includes(message.rating) ? message.rating : undefined
  };
}

function portableChat(chat) {
  return {
    id:chat.id, title:text(chat.title, 120), created:date(chat.created), updated:date(chat.updated),
    folder:text(chat.folder, 80), labels:normalizeLabels(Array.isArray(chat.labels) ? chat.labels : []),
    pinned:chat.pinned === true, archived:chat.archived === true,
    pinnedFacts:text(chat.pinnedFacts,4000),compactHistory:chat.compactHistory===true,
    historyChars:Number.isInteger(chat.historyChars)&&chat.historyChars>=2000&&chat.historyChars<=150000?chat.historyChars:undefined,
    branchParent:chat.branchParent ? {chatId:chat.branchParent.chatId, messageId:chat.branchParent.messageId} : undefined,
    messages:chat.messages.map(portableMessage)
  };
}

export function exportChatBundle(state, selectedIds) {
  const ids = new Set(selectedIds ?? state.chats.map(chat => chat.id));
  if (selectedIds) {
    let changed;
    do {
      changed = false;
      for (const chat of state.chats) {
        const parent = chat.branchParent?.chatId;
        if (parent && ids.has(chat.id) && !ids.has(parent)) { ids.add(parent); changed = true; }
        if (parent && ids.has(parent) && !ids.has(chat.id)) { ids.add(chat.id); changed = true; }
      }
    } while (changed);
  }
  return {
    format, version:1,
    chats:state.chats.filter(chat => ids.has(chat.id)).map(portableChat),
    attachments:state.files.filter(file => file.chatId && ids.has(file.chatId)).map(file => ({
      chatId:file.chatId, name:text(file.name, 120), text:text(file.text, 40000), created:date(file.created)
    }))
  };
}

function chatGptConversation(conversation) {
  const mapping = conversation?.mapping;
  if (!mapping || typeof mapping !== 'object') throw new Error('Choose a Kapron bundle or a ChatGPT conversations.json export.');
  const nodes = [];
  const visited = new Set();
  let nodeId = conversation.current_node;
  if (!nodeId) throw new Error('A ChatGPT conversation is missing its active branch.');
  while (nodeId) {
    if (visited.has(nodeId) || visited.size >= 4000 || !Object.hasOwn(mapping, nodeId)) throw new Error('A ChatGPT conversation has an invalid message tree.');
    visited.add(nodeId);
    const node = mapping[nodeId];
    const message = node.message;
    const role = message?.author?.role;
    const parts = message?.content?.parts;
    if (['user','assistant'].includes(role) && Array.isArray(parts) && message.metadata?.is_visually_hidden_from_conversation !== true) {
      const body = parts.filter(part => typeof part === 'string').join('\n');
      if (body) nodes.push({id:nodeId,role,text:body,created:message.create_time});
    }
    nodeId = node.parent;
  }
  return {id:conversation.id ?? conversation.conversation_id,title:conversation.title,created:conversation.create_time,updated:conversation.update_time,messages:nodes.reverse()};
}

export function importChatBundle(document, state, {createId = () => crypto.randomUUID(), now = () => new Date().toISOString()} = {}) {
  const external = Array.isArray(document);
  if (!external && (document?.format !== format || document.version !== 1 || !Array.isArray(document.chats) || !Array.isArray(document.attachments))) {
    throw new Error('Choose a Kapron bundle or a ChatGPT conversations.json export.');
  }
  const incoming = external ? document : document.chats;
  const attachments = external ? [] : document.attachments;
  if (!incoming.length || state.chats.length + incoming.length > 250 || state.files.length + attachments.length > 250) {
    throw new Error('Import would exceed the workspace limit of 250 chats or attachments.');
  }
  const records = external ? incoming.map(chatGptConversation) : incoming;
  const chatIds = new Map();
  const messageIds = new Map();
  for (const chat of records) {
    if (typeof chat?.id !== 'string' || !chat.id || chatIds.has(chat.id) || !Array.isArray(chat.messages) || chat.messages.length > 500) {
      throw new Error('The import contains an invalid chat or exceeds 500 messages per chat.');
    }
    chatIds.set(chat.id, createId());
    const seen = new Set();
    for (const message of chat.messages) {
      if (typeof message?.id !== 'string' || !message.id || seen.has(message.id) || !['user','assistant'].includes(message.role) || typeof message.text !== 'string') {
        throw new Error('The import contains an invalid message.');
      }
      seen.add(message.id);
      // A branched Kapron conversation shares the IDs of its inherited turns.
      if (!messageIds.has(message.id)) messageIds.set(message.id, createId());
    }
  }
  const translated = records.map(chat => {
    const clean = portableChat(chat);
    const parentId = chatIds.get(clean.branchParent?.chatId);
    const parent = records.find(item => item.id === clean.branchParent?.chatId);
    const parentMessage = parent?.messages.find(item => item.id === clean.branchParent?.messageId && item.role === 'user');
    return {...clean,id:chatIds.get(chat.id),title:clean.title || 'Imported chat',created:clean.created ?? now(),updated:clean.updated ?? now(),
      projectId:null,choice:null,activeGemId:null,contextPrefs:{},
      branchParent:parentId && parentId !== chatIds.get(chat.id) && parentMessage ? {chatId:parentId,messageId:messageIds.get(parentMessage.id)} : undefined,
      messages:clean.messages.map(message => ({...message,id:messageIds.get(message.id),created:message.created ?? now()}))};
  });
  const files = attachments.map(file => {
    const chatId = chatIds.get(file?.chatId);
    if (!chatId || typeof file.name !== 'string' || typeof file.text !== 'string') throw new Error('The bundle contains an invalid attachment.');
    return {id:createId(), chatId, projectId:null, name:text(file.name,120), text:text(file.text,40000), created:date(file.created) ?? now()};
  });
  const next = {...state,chats:[...translated,...state.chats],files:[...state.files,...files]};
  if (new TextEncoder().encode(JSON.stringify({state:next,revision:0})).length > 795000) {
    throw new Error('This import would exceed the workspace storage limit. Import a smaller bundle.');
  }
  return {next, chats:translated.length, files:files.length};
}
