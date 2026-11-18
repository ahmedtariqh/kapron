import {expect,test} from '@playwright/test';

const origin='http://127.0.0.1:4188';
test.use({baseURL:origin});

test('signup confirms by email, refreshes the browser session and supports password sign-in and sign-out',async({page,context})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Create an account'}).click();
  await page.getByLabel('Email').fill('fixture@example.test');
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button',{name:'Create account',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Confirm your email, then sign in.');
  await page.goto('/api/auth/callback/email?code=test-email-code');
  await expect(page.getByRole('button',{name:/My workspace/})).toBeVisible();
  const cookies=await context.cookies(origin);
  expect(cookies.find(cookie=>cookie.name==='__Host-kapron-refresh')).toMatchObject({httpOnly:true,secure:true,sameSite:'Lax'});
  await context.clearCookies({name:'__Host-kapron-session'});
  const renewal=page.waitForResponse(response=>response.url().endsWith('/api/auth/refresh')&&response.ok());
  await page.reload();
  await renewal;
  await expect(page.getByRole('button',{name:/My workspace/})).toBeVisible();
  await page.getByRole('button',{name:/My workspace/}).click();
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Open your workspace'})).toBeVisible();
  await page.getByLabel('Email').fill('fixture@example.test');
  await page.getByLabel('Password').fill('bad-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText(/Sign-in failed/);
  await page.getByLabel('Password').fill('test-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:/My workspace/})).toBeVisible();
});

test('Google delegates to Supabase and returns to the authenticated workspace',async({page})=>{
  await page.route('https://kapron-auth-fixture.supabase.co/auth/v1/authorize?**',async route=>{
    const url=new URL(route.request().url());
    expect(url.searchParams.get('provider')).toBe('google');
    expect(url.searchParams.get('code_challenge_method')).toBe('s256');
    const callback=url.searchParams.get('redirect_to');
    expect(callback).toBe(origin+'/api/auth/callback/google');
    await route.fulfill({status:302,headers:{location:callback+'?code=test-google-code'}});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Continue with Google'}).click();
  await expect(page.getByRole('button',{name:/My workspace/})).toBeVisible();
  expect(page.url()).toBe(origin+'/');
  expect(await page.evaluate(()=>document.cookie)).not.toContain('kapron');
});
