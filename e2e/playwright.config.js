import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'.',workers:1,timeout:35000,
  use:{baseURL:'http://127.0.0.1:4187',acceptDownloads:true,launchOptions:{executablePath:process.env.KAPRON_CHROMIUM||undefined}},
  webServer:[{command:'node e2e/notebook-fixture.mjs',cwd:new URL('..',import.meta.url).pathname,url:'http://127.0.0.1:4187',timeout:15000,
    env:{PORT:'4187',KAPRON_LOCAL_DIRECTORY:process.env.KAPRON_E2E_DIRECTORY||'.kapron/e2e'}},
    {command:'node e2e/auth-fixture.mjs',cwd:new URL('..',import.meta.url).pathname,url:'http://127.0.0.1:4188',timeout:15000}]
});
