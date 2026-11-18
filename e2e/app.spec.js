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
