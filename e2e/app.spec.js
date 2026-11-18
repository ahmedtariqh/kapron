import {test,expect} from '@playwright/test';

test('discovers gateway models and streams a chat through the selected workspace default',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Add connection',exact:true}).first().click();
  const editor=page.getByRole('dialog');
  await expect(editor.getByRole('combobox',{name:'Provider',exact:true})).toHaveValue('litellm');
  await editor.getByLabel('API key',{exact:true}).fill('mock-browser-gateway-key');
  await editor.getByRole('button',{name:'Load gateway models'}).click();
  await editor.getByRole('combobox',{name:'Discovered model',exact:true}).selectOption('fixture/text');
  await editor.getByRole('button',{name:'Add connection',exact:true}).click();
  await expect(page.getByText('Connection saved')).toBeVisible();
  await expect(page.getByText('LiteLLM Proxy · fixture/text')).toBeVisible();
  await page.getByRole('button',{name:'New chat'}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Check the configured gateway.');
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.getByText('Gateway fixture streamed the answer.')).toBeVisible();
  // Restore single-user fixture defaults before the existing Demo/Auto scenarios.
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  const connection=page.getByRole('article').filter({hasText:'LiteLLM Proxy'});
  await connection.getByRole('button',{name:'Delete LiteLLM Proxy'}).click();
  await page.getByRole('dialog').getByRole('button',{name:/^Remove/}).click();
  await expect(page.getByText('Kapron Demo · local-demo')).toBeVisible();
});

test('Auto scopes resources, streams a reply, and opens its run details',async({page})=>{
  const suffix=Date.now();
  await page.goto('/');
  await page.getByRole('button',{name:'Skills',exact:true}).click();
  await page.getByRole('button',{name:'Add skill',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Debugging '+suffix);
  await page.getByLabel('Routing description').fill('debug bug repo');
  await page.getByLabel('Task family').selectOption('coding');
  await page.getByLabel('Instructions',{exact:true}).fill('Check the exact reproduction steps.');
  await page.getByRole('button',{name:'Save skill'}).click();
  await expect(page.getByText('Resource saved')).toBeVisible();
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Change default'}).click();
  await page.getByRole('combobox',{name:/^Connection/}).selectOption('auto');
  await page.getByRole('button',{name:'Save default'}).click();
  await page.getByRole('button',{name:'New chat'}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Debug a repo with a recurring bug.');
  await page.getByRole('button',{name:'Send message'}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Send message'}).click();
  await expect(page.getByText('A starting point')).toBeVisible();
  await page.getByRole('button',{name:'Run details'}).click();
  await expect(page.getByText('rules · coding')).toBeVisible();
  await expect(page.getByText('Debugging '+suffix+' v1')).toBeVisible();
});

test('creates a workflow and shows its completed background output',async({page})=>{
  const name='Demo flow '+Date.now();
  await page.goto('/');
  await page.getByRole('button',{name:'Workflows',exact:true}).click();
  await page.getByRole('button',{name:'New workflow',exact:true}).click();
  await page.getByLabel('Workflow name').fill(name);
  await page.getByLabel('Default connection').selectOption('demo');
  await page.getByLabel('Prompt',{exact:true}).fill('Write a short checklist.');
  await page.getByRole('button',{name:'Save workflow'}).click();
  const workflow=page.getByRole('article',{name:''}).filter({hasText:name});
  await workflow.getByRole('button',{name:'Run workflow'}).click();
  await page.getByRole('button',{name:'Queue run'}).click();
  await page.getByRole('button',{name:new RegExp('^'+name+' (queued|running|completed)')}).click();
  await expect(page.getByText('completed · 1/1 steps').first()).toBeVisible({timeout:15000});
  await page.getByText('prompt · local-demo').click();
  await expect(page.getByRole('button',{name:'Open in Canvas'})).toBeVisible();
});

test('runs Canvas JavaScript in an isolated worker, exports Office formats, and shares an artifact',async({page,context})=>{
  const name='Calculation '+Date.now();
  await page.goto('/');
  await page.getByRole('button',{name:'Canvas',exact:true}).click();
  await page.getByRole('button',{name:'New artifact'}).click();
  await page.getByLabel('Title',{exact:true}).fill(name);
  await page.getByRole('combobox',{name:/^Format/}).selectOption('javascript');
  await page.getByRole('textbox',{name:/^Content/}).fill('console.log(6 * 7);');
  await page.getByRole('button',{name:'Run JavaScript'}).click();
  await expect(page.getByRole('status').filter({hasText:'42'})).toBeVisible();
  await page.getByRole('textbox',{name:/^Content/}).fill('try { await fetch("/api/session"); } catch { console.log("network denied"); }');
  await page.getByRole('button',{name:'Run JavaScript'}).click();
  await expect(page.getByRole('status').filter({hasText:'network denied'})).toBeVisible();
  await page.getByRole('combobox',{name:/^Format/}).selectOption('csv');
  await page.getByRole('textbox',{name:/^Content/}).fill('Day,Value\nMonday,42\nTotal,=SUM(B2:B2)');
  for(const type of ['docx','xlsx','pptx']){
    const download=page.waitForEvent('download');
    await page.getByLabel('Export file').selectOption(type);
    const item=await download;
    expect(item.suggestedFilename()).toBe(name+'.'+type);
    expect(await item.failure()).toBeNull();
  }
  await page.getByRole('button',{name:'Save artifact'}).click();
  await page.getByRole('article').filter({hasText:name}).getByRole('button',{name:'Share snapshot'}).click();
  await page.getByRole('button',{name:'Create link'}).click();
  const url=await page.getByLabel('Share link').inputValue();
  const shared=await context.newPage();
  await shared.goto(url);
  await expect(shared.getByRole('heading',{name})).toBeVisible();
  await expect(shared.getByText('Monday,42',{exact:false})).toBeVisible();
});

test('local decision fallback selects a task family and leaves prompt context out of the decision request',async({page})=>{
  await page.route('http://127.0.0.1:8765/decide',async request=>{
    const body=request.request().postDataJSON();
    expect(body.state.task).toBe('Evaluate this prototype');
    expect(Object.keys(body.state)).toEqual(['task']);
    const answers={family:{type:'choice',choice:'analysis',confidence:.92,probabilities:{general:.02,coding:.02,research:.02,analysis:.92,writing:.02}}};
    for(const key of Object.keys(body.questions).filter(k=>k!=='family'))answers[key]={type:'noul',noul:0};
    await request.fulfill({json:{answers},headers:{'access-control-allow-origin':'http://127.0.0.1:4187'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Configure',exact:true}).click();
  await page.getByLabel('Local Laya URL').fill('http://127.0.0.1:8765/decide');
  await page.getByRole('button',{name:'Save routing settings'}).click();
  await page.getByRole('button',{name:'Change default'}).click();
  await page.getByRole('combobox',{name:/^Connection/}).selectOption('auto');
  await page.getByRole('button',{name:'Save default'}).click();
  await page.getByRole('button',{name:'New chat'}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Evaluate this prototype');
  await page.getByRole('button',{name:'Send message'}).click();
  if(await page.getByRole('dialog').count())await page.getByRole('dialog').getByRole('button',{name:'Send message'}).click();
  await page.getByRole('button',{name:'Run details'}).click();
  await expect(page.getByText('laya · analysis')).toBeVisible();
});

test('notebook integration lists an approved notebook and returns citations in Cowork',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Integrations',exact:true}).click();
  await page.getByRole('button',{name:'Check connection and list notebooks'}).click();
  await page.getByRole('button',{name:/Kapron research fixture.*Ask in Cowork/}).click();
  await page.getByRole('textbox',{name:/Question for NotebookLM/}).fill('What did the approved source conclude?');
  await page.getByRole('button',{name:'Start task'}).click();
  await page.getByRole('button',{name:/^Ask Kapron research fixture (queued|running|completed)/}).first().click();
  await expect(page.getByText('completed · 1/1 steps').first()).toBeVisible({timeout:15000});
  await page.getByText('Ask NotebookLM · NotebookLM',{exact:true}).click();
  await expect(page.getByText(/Approved source excerpt/)).toBeVisible();
});

test('voice prompt inserts editable text without sending a message',async({page})=>{
  await page.addInitScript(()=>{
    window.SpeechRecognition=class{
      start(){setTimeout(()=>{this.onresult({results:[[{transcript:'صباح الخير'}]]});},10);}
      stop(){this.onend();}
      abort(){}
    };
  });
  await page.goto('/');
  await page.getByRole('button',{name:'New chat'}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Draft:');
  await page.getByRole('button',{name:'Voice prompt',exact:true}).click();
  await page.getByRole('combobox',{name:'Spoken language'}).selectOption('ar');
  await page.getByRole('button',{name:'Start recording'}).click();
  await expect(page.getByRole('textbox',{name:'Transcript'})).toHaveValue('صباح الخير');
  await page.getByRole('button',{name:'Stop recording'}).click();
  await page.getByRole('button',{name:'Add to draft'}).click();
  await expect(page.getByRole('textbox',{name:'Message',exact:true})).toHaveValue('Draft: صباح الخير');
  await expect(page.getByRole('article',{name:'Your message'})).toHaveCount(0);
});

test('live voice widget negotiates a call, mutes, stops the mic, and saves completed turns',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await page.addInitScript(()=>{
    const track={enabled:true,stop(){window.testMicStopped=true;}};
    window.testVoiceTrack=track;
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})});
    window.RTCPeerConnection=class{
      addTrack(){}
      createDataChannel(){
        this.channel={close(){}};
        return this.channel;
      }
      async createOffer(){return {type:'offer',sdp:'v=0\r\nm=audio offer\r\nm=application events'};}
      async setLocalDescription(value){this.localDescription=value;}
      async setRemoteDescription(){
        this.channel.onopen();
        const send=event=>this.channel.onmessage({data:JSON.stringify(event)});
        send({type:'input_audio_buffer.speech_started',item_id:'u1'});
        send({type:'response.output_audio_transcript.done',item_id:'a1',transcript:'I can hear you.'});
        send({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Hello Kapron'});
        send({type:'output_audio_buffer.stopped'});
      }
      close(){window.testPeerClosed=true;}
    };
  });
  const workspace=await (await page.request.get('/api/workspace')).json();
  workspace.state.connections.push({id:'voice-test',provider:'openai',name:'Voice test',model:'unused-text-model',mode:'vault'});
  expect((await page.request.put('/api/workspace',{data:workspace,headers:{'x-kapron-request':'1'}})).ok()).toBe(true);
  await page.route('**/api/voice/live',route=>{
    expect(route.request().postDataJSON().connectionId).toBe('voice-test');
    return route.fulfill({json:{model:'gpt-realtime-2',sdp:'v=0'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'New chat'}).click();
  await page.getByRole('button',{name:'Live voice',exact:true}).click();
  await page.getByRole('combobox',{name:'OpenAI connection'}).selectOption('voice-test');
  await page.getByRole('button',{name:'Start live voice',exact:true}).click();
  await expect(page.getByText('I can hear you.')).toBeVisible();
  await page.getByRole('button',{name:'Mute',exact:true}).click();
  expect(await page.evaluate(()=>window.testVoiceTrack.enabled)).toBe(false);
  await page.getByRole('button',{name:'End call'}).click();
  expect(await page.evaluate(()=>window.testMicStopped&&window.testPeerClosed)).toBe(true);
  await page.getByRole('button',{name:'Save transcript to chat'}).click();
  await expect(page.getByRole('article',{name:'Your message'})).toContainText('Hello Kapron');
  await expect(page.getByRole('article',{name:'Assistant reply'})).toContainText('I can hear you.');
});

test('temporary chat leaves no workspace transcript or browser draft',async({page})=>{
  const prompt='Temporary browser fixture';
  await page.goto('/');
  await page.getByRole('button',{name:'Temporary chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill(prompt);
  await page.getByRole('button',{name:'Send message'}).click();
  await expect(page.getByRole('article',{name:'Assistant reply'})).toContainText(prompt);
  await expect(page.getByRole('button',{name:'Open reply in Canvas'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Attach files'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Send message'})).toBeVisible();
  const response=await page.request.get('/api/workspace');
  expect(JSON.stringify(await response.json())).not.toContain(prompt);
  expect(await page.evaluate(text=>Object.values(localStorage).some(value=>value.includes(text)),prompt)).toBe(false);
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  await expect(page.getByText(prompt,{exact:true})).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(prompt,{exact:true})).toHaveCount(0);
});

test('edited branch retains the original and supports comparison',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Change default',exact:true}).click();
  await page.getByRole('dialog').getByRole('combobox',{name:'Connection'}).selectOption('demo');
  await page.getByRole('button',{name:'Save default'}).click();
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  const message=page.getByRole('textbox',{name:'Message',exact:true});
  await message.fill('Original branch fixture');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const review=page.getByRole('dialog').getByRole('button',{name:'Send message',exact:true});
  if(await review.isVisible())await review.click();
  await expect(page.getByRole('button',{name:'Branch from this message'})).toBeVisible();
  await page.getByRole('button',{name:'Branch from this message'}).click();
  await page.getByLabel('Edited message').fill('Edited branch fixture');
  await page.getByRole('button',{name:'Create branch'}).click();
  await expect(message).toHaveValue('Edited branch fixture');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  if(await review.isVisible())await review.click();
  await expect(page.getByRole('button',{name:'Branch from this message'})).toBeVisible();
  await page.getByRole('button',{name:'Bookmark reply'}).click();
  await expect(page.getByRole('button',{name:'Bookmark reply'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Rate reply helpful'}).click();
  await expect(page.getByRole('button',{name:'Rate reply helpful'})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Quote reply'}).click();
  await expect(message).toHaveValue(/> .*Edited branch fixture/);
  await page.getByRole('button',{name:'Chat details'}).click();
  await page.getByRole('button',{name:'Compare',exact:true}).click();
  const comparison=page.getByRole('dialog');
  await expect(comparison).toContainText('Original branch fixture');
  await expect(comparison).toContainText('Edited branch fixture');
  await page.reload();
  await expect(page.getByRole('button',{name:'Branch · Edited branch fixture',exact:true})).toBeVisible();
});

test('discovers a browser-local model and verifies streaming without uploading a device key',async({page})=>{
  const endpoint='http://127.0.0.1:11434/v1';
  const fixtureKey='device-only-fixture';
  const serverUploads=[];
  page.on('request',request=>{if(request.url().startsWith('http://127.0.0.1:4187/api/')&&request.postData()?.includes(fixtureKey))serverUploads.push(request.url());});
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','access-control-allow-methods':'GET,POST,OPTIONS'};
  await page.route(endpoint+'/**',async route=>{
    const request=route.request();
    if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:cors});return;}
    expect(request.headers().authorization).toBe('Bearer '+fixtureKey);
    if(request.url().endsWith('/models')){await route.fulfill({json:{data:[{id:'test/local',context_length:8192}]},headers:cors});return;}
    expect(request.postDataJSON().model).toBe('test/local');
    await route.fulfill({headers:{...cors,'content-type':'text/event-stream'},body:'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Connections',exact:true}).click();
  await page.getByRole('button',{name:'Add connection',exact:true}).first().click();
  const editor=page.getByRole('dialog');
  await editor.getByRole('combobox',{name:'Provider'}).selectOption('custom');
  await editor.getByLabel(/API base URL/).fill(endpoint);
  await editor.getByLabel(/API key/).fill(fixtureKey);
  await editor.getByRole('button',{name:'Discover local models'}).click();
  await editor.getByRole('combobox',{name:'Discovered model'}).selectOption('test/local');
  await editor.getByRole('button',{name:'Test with a short prompt'}).click();
  await expect(editor.getByRole('status')).toContainText('streamed a reply');
  expect(serverUploads).toEqual([]);
});

test('project-only memory stays in the selected project context',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('button',{name:'New project',exact:true}).first().click();
  await page.getByLabel('Project name').fill('Scoped fixture project');
  await page.getByLabel('Project memory').selectOption('project');
  await page.getByRole('button',{name:'Create project',exact:true}).click();
  await page.getByRole('button',{name:'Memory',exact:true}).click();
  await page.getByRole('button',{name:'Add memory',exact:true}).first().click();
  await page.getByRole('combobox',{name:'Memory scope'}).selectOption({label:'Scoped fixture project'});
  await page.getByLabel(/What should Kapron remember/).fill('Project-only fixture fact');
  await page.getByRole('button',{name:'Save memory'}).click();
  await page.getByRole('button',{name:'Projects',exact:true}).click();
  await page.getByRole('article').filter({hasText:'Scoped fixture project'}).getByRole('button',{name:'Open project'}).click();
  await page.getByRole('textbox',{name:'Message',exact:true}).fill('Check the project-only context.');
  const run=page.waitForRequest(request=>request.url().endsWith('/api/runs')&&request.method()==='POST');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const review=page.getByRole('dialog').getByRole('button',{name:'Send message',exact:true});
  if(await review.isVisible())await review.click();
  expect((await run).postDataJSON().instruction).toContain('User supplied project memory:\nProject-only fixture fact');
  await expect(page.getByRole('article',{name:'Assistant reply'})).toContainText('Check the project-only context.');
});

test('history imports, filters, pins, archives, restores and downloads a chat bundle',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Chat history',exact:true}).click();
  await page.getByRole('button',{name:'Import chats',exact:true}).click();
  const bundle={format:'kapron.chat-bundle',version:1,chats:[
    {id:'example',title:'Imported portability fixture',folder:'Research',labels:['literature'],messages:[{id:'turn',role:'user',text:'Distinct imported transcript'}]}
  ],attachments:[{chatId:'example',name:'Imported notes.txt',text:'Searchable imported attachment text'}]};
  await page.getByLabel('Chat export file').setInputFiles({name:'kapron.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(bundle))});
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('1 chats and 1 text attachments');
  await page.getByRole('button',{name:'Import to workspace'}).click();
  await page.getByLabel('Search history').fill('distinct transcript');
  await page.getByRole('combobox',{name:'Folder'}).selectOption('Research');
  await page.getByRole('combobox',{name:'Label'}).selectOption('literature');
  await page.getByRole('button',{name:'Pin Imported portability fixture',exact:true}).click();
  await page.getByRole('combobox',{name:'View'}).selectOption('pinned');
  const box=page.getByRole('checkbox',{name:'Select Imported portability fixture'});
  await box.check();
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Export selected chats'}).click();
  const exported=await download;
  const stream=await exported.createReadStream();
  const chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const saved=JSON.parse(Buffer.concat(chunks).toString());
  expect(saved.attachments[0].text).toBe(bundle.attachments[0].text);
  await page.getByRole('button',{name:'Archive selected'}).click();
  await expect(box).toHaveCount(0);
  await page.getByRole('combobox',{name:'View'}).selectOption('archived');
  await box.check();
  await page.getByRole('button',{name:'Restore selected'}).click();
  await expect(box).toHaveCount(0);
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Search workspace',exact:true}).click();
  await page.getByRole('textbox',{name:'Search workspace',exact:true}).fill('searchable imported attachment');
  await page.getByRole('combobox',{name:'Type'}).selectOption('file');
  await page.getByRole('button',{name:/Imported notes.txt/}).click();
  await expect(page.getByRole('dialog')).toContainText('Searchable imported attachment text');
});

test('rerun and continuation review the context before dispatch',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'New chat',exact:true}).click();
  const message=page.getByRole('textbox',{name:'Message',exact:true});
  await message.fill('Rerun fixture prompt');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const review=page.getByRole('dialog').getByRole('button',{name:'Send message',exact:true});
  if(await review.isVisible())await review.click();
  await expect(page.getByRole('article',{name:'Assistant reply'})).toContainText('Rerun fixture prompt');
  await page.getByRole('button',{name:'Rerun with settings',exact:true}).click();
  await page.getByLabel('Output token limit').fill('64');
  await page.getByRole('button',{name:'Review rerun',exact:true}).click();
  const rerun=page.waitForRequest(request=>request.url().endsWith('/api/runs')&&request.method()==='POST');
  await review.click();
  expect((await rerun).postDataJSON().options.maxOutput).toBe(64);
  await expect(page.getByRole('article',{name:'Assistant reply'})).toContainText('Rerun fixture prompt');
  await page.getByRole('button',{name:'Continue reply',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('History preview');
  await expect(page.getByRole('checkbox',{name:'Recent chat history'})).toBeChecked();
});

test('goals persist linked work and checkpoint progress',async({page})=>{
  const workspace=await (await page.request.get('/api/workspace')).json();
  workspace.state.chats.push({id:'goal-source-fixture',title:'Goal source fixture',messages:[{id:'goal-source-turn',role:'user',text:'Linked evidence for the goal'}]});
  expect((await page.request.put('/api/workspace',{headers:{'x-kapron-request':'1'},data:workspace})).ok()).toBe(true);
  await page.goto('/');
  await page.getByRole('button',{name:'Goals',exact:true}).click();
  await page.getByRole('button',{name:'New goal',exact:true}).click();
  await page.getByLabel('Goal title').fill('Verify workspace checks');
  await page.getByRole('button',{name:'Add milestone'}).click();
  await page.getByLabel('Milestone 1').fill('Complete first checkpoint');
  await page.getByLabel('Checkpoint date').fill('2026-12-01');
  await page.getByRole('combobox',{name:'Link work'}).selectOption({label:'Chat · Goal source fixture'});
  await page.getByRole('button',{name:'Save goal'}).click();
  await page.getByRole('checkbox',{name:/Complete first checkpoint/}).click();
  await expect(page.getByText('1 of 1 milestones complete')).toBeVisible();
  await page.reload();
  await page.getByRole('button',{name:'Goals',exact:true}).click();
  await expect(page.getByText('1 of 1 milestones complete')).toBeVisible();
  await page.getByRole('button',{name:'Chat · Goal source fixture'}).click();
  await expect(page.getByRole('article',{name:'Your message'})).toContainText('Linked evidence for the goal');
});

test('library organizes a reference and restores an earlier Canvas version',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Library',exact:true}).click();
  await page.getByRole('button',{name:'Add to library',exact:true}).click();
  await page.getByRole('combobox',{name:'Entry type'}).selectOption('reference');
  await page.getByLabel('Reference title').fill('Reference fixture library');
  await page.getByLabel('Reference URL').fill('https://example.com/reference');
  await page.getByLabel('Reference notes').fill('Distinct reference notes');
  await page.getByLabel('Folder',{exact:true}).fill('Reference shelf');
  await page.getByLabel('Tags',{exact:true}).fill('study');
  await page.getByRole('button',{name:'Save library item'}).click();
  await page.getByRole('combobox',{name:'Library tag'}).selectOption('study');
  const reference=page.getByRole('article').filter({hasText:'Reference fixture library'});
  await reference.getByRole('button',{name:'Open',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('link',{name:'Open reference'})).toHaveAttribute('href','https://example.com/reference');
  await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Canvas',exact:true}).click();
  await page.getByRole('button',{name:'New artifact',exact:true}).click();
  await page.getByLabel('Title',{exact:true}).fill('Versioned library fixture');
  const content=page.getByRole('textbox',{name:'Content',exact:true});
  await content.fill('First version');
  await page.getByRole('button',{name:'Save artifact'}).click();
  const edit=page.getByRole('button',{name:'Edit Versioned library fixture'});
  await edit.click();
  await content.fill('Second version');
  await page.getByRole('button',{name:'Save artifact'}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await edit.click();
  await page.getByText('Version history',{exact:true}).click();
  await page.getByRole('button',{name:'Restore version 1 to editor'}).click();
  await expect(content).toHaveValue('First version');
});
