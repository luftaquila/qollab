import {test,expect,type BrowserContext,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
const origin='http://127.0.0.1:3200';
async function login(context:BrowserContext,index=0){const users=JSON.parse(await readFile('tmp/e2e-sessions.json','utf8'));const user=users[index];await context.addCookies([{name:'qollab',value:user.raw,url:origin,httpOnly:true,sameSite:'Lax'}]);return user;}
async function call(page:Page,user:any,path:string,method='GET',body?:unknown){const r=await page.request.fetch(origin+'/api'+path,{method,headers:{origin,'x-csrf-token':user.csrf},data:body});expect(r.ok(),await r.text()).toBeTruthy();return r.json();}
async function makeProject(page:Page,user:any){const p=await call(page,user,'/projects','POST',{name:'Browser '+Date.now()});await page.goto('/');await page.getByRole('button',{name:/Browser/}).first().click();await expect(page.locator('.ProseMirror')).toBeVisible();await expect(page.getByText('Saved to server',{exact:false})).toBeVisible();await page.waitForTimeout(300);const unchanged=await call(page,user,'/projects/'+p.id);expect(Number(unchanged.revision)).toBe(0);expect(unchanged.data.files[0].source).toBe('# Untitled\n\n');return p.id;}
test('language priority and login shell exclude editor, math and PDF assets',async({browser})=>{
 const context=await browser.newContext({locale:'ko-KR'}),page=await context.newPage(),requests:string[]=[];page.on('request',r=>requests.push(r.url()));await page.goto('/');await expect(page.getByText('함께 쓰고, 문서로 완성하세요.')).toBeVisible();expect(requests.some(r=>/Editor-|Pdf-|pdf\.worker|KaTeX/.test(r))).toBe(false);await page.screenshot({path:'tmp/login-ko.png'});await context.close();
});
test('two browsers collaborate, preserve personal undo, upload images and retain source on reopen',async({browser})=>{
 const a=await browser.newContext({locale:'en-US'}),b=await browser.newContext({locale:'ko-KR'}),ua=await login(a),ub=await login(b,1),pa=await a.newPage(),pb=await b.newPage(),errors:string[]=[];
 pa.on('pageerror',e=>errors.push(e.message));pb.on('pageerror',e=>errors.push(e.message));const id=await makeProject(pa,ua);let p=await call(pa,ua,'/projects/'+id);
 const inv=await call(pa,ua,`/projects/${id}/invites`,'POST',{revision:Number(p.revision),email:'bob@example.com',role:'editor'});await call(pb,ub,'/invites/accept','POST',{token:new URL(inv.result.url).searchParams.get('invite')});
 await pb.goto('/');await pb.getByRole('button',{name:/Browser/}).first().click();await expect(pb.locator('.ProseMirror')).toBeVisible();
 const ea=pa.locator('.ProseMirror'),eb=pb.locator('.ProseMirror');await ea.click();await pa.keyboard.press('ControlOrMeta+End');await pa.keyboard.press('Enter');await pa.keyboard.insertText('Alice wrote this.');await expect(eb).toContainText('Alice wrote this.');
 await eb.click();await pb.keyboard.press('ControlOrMeta+End');await pb.keyboard.press('Enter');await pb.keyboard.insertText('한글 공동 편집');await expect(ea).toContainText('한글 공동 편집');
 await pa.getByTitle('Undo',{exact:true}).click();await expect(ea).toContainText('한글 공동 편집');await expect(eb).not.toContainText('Alice wrote this.');await pa.getByTitle('Redo',{exact:true}).click();await expect(eb).toContainText('Alice wrote this.');
 await expect(pa.getByText('Saved to server',{exact:false})).toBeVisible();
 // IME protocol through Chromium, with remote edits between composition events.
 const cdp=await a.newCDPSession(pa);await ea.click();await pa.keyboard.press('ControlOrMeta+End');await cdp.send('Input.imeSetComposition',{text:'ㅎ',selectionStart:1,selectionEnd:1});await eb.click();await pb.keyboard.press('ControlOrMeta+Home');await pb.keyboard.insertText('Remote ');await cdp.send('Input.imeSetComposition',{text:'한글',selectionStart:2,selectionEnd:2});await cdp.send('Input.insertText',{text:'한글'});await expect(eb).toContainText('한글');
 // Choose and insert an uploaded image only after the asset has been persisted.
 await pa.getByRole('button',{name:'Images',exact:true}).click();const png=await sharp({create:{width:120,height:60,channels:3,background:'#237f79'}}).png().toBuffer();await pa.locator('input[type=file][accept="image/png,image/jpeg"]').setInputFiles({name:'figure.png',mimeType:'image/png',buffer:png});await expect(pa.locator('.modal')).toBeVisible();await pa.getByLabel('Caption',{exact:true}).fill('Example figure');await pa.locator('.modal').getByRole('button',{name:'Insert',exact:true}).click();await expect(pa.locator('.milkdown img[src*=resource]').first()).toBeVisible();
 await expect.poll(async()=>{const result=await call(pa,ua,'/projects/'+id);return result.data.files[0].source;}).toContain('assets/images/');p=await call(pa,ua,'/projects/'+id);expect(p.data.files[0].source).not.toMatch(/blob:|data:image/);
 await pa.screenshot({path:'tmp/editor-collab.png'});await pa.reload();await pa.getByRole('button',{name:/Browser/}).first().click();await expect(pa.locator('.ProseMirror')).toContainText('한글');expect(errors).toEqual([]);await a.close();await b.close();
});
