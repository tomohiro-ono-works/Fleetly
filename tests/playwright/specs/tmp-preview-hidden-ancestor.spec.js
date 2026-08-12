const { test } = require('@playwright/test');

test('debug hidden ancestor', async ({ page }) => {
  await page.route('**/static/js/bridge.js*', async (route) => {
    const body = `(function(){ const b={available(){return true;},status(){return {state:'ready',ready:true};},unavailableMessage(){return '';},call(t,p){ if(t==='app.getStatus') return Promise.resolve({gui_mode:'webview',host:'qt'}); if(t==='workspace.getRoot') return Promise.resolve({has_root:true,root_path:'C:/Users/tomoh/Documents/Sandbox/zizai/workflows',config_path:'C:/Users/tomoh/Documents/Sandbox/zizai/config'}); if(t==='workspace.list') return Promise.resolve({scope:p?.scope||'root',entries:[]}); if(t==='workspace.readText') return Promise.resolve({content:'[]',encoding:'utf-8',mtime_ns:String(Date.now()),size:2,file_name:'recent_roots.json'}); if(t==='workspace.writeText') return Promise.resolve({saved:true}); if(t==='app.logUiEvent') return Promise.resolve({ok:true}); return Promise.resolve({});}}; window.zizPackages=window.zizPackages||{}; window.zizPackages.core=window.zizPackages.core||{}; window.zizPackages.core.bridge=b; setTimeout(()=>window.dispatchEvent(new CustomEvent('ziz:bridge-ready')),0);})();`;
    await route.fulfill({ status: 200, contentType: 'application/javascript; charset=utf-8', body });
  });
  await page.goto('/static/dataflow.html');
  const flow={metadata:{mode:'dataflow',name:'x'},variables:{start:[]},steps:[{step_id:'step1',connector:'ExcelConnector',action:'read_excel',params:{file_path:'',sheet_name:'Sheet1',header_row:1,data_start_row:2,schema:'[]'},output_variable:'step1',description:'Excel / 読み込み'}],flows:{start:'START',end:'END',edges:[{from:'START',to:'step1',kind:'primary',order:1},{from:'step1',to:'END',kind:'primary',order:1}]},notes:[]};
  await page.evaluate((payload)=>window.dispatchEvent(new CustomEvent('ziz:workspace-flow-open',{detail:{selected:true,mode:'dataflow',file_name:'x.zizd',hidden_bindings:{},flow:payload}})), flow);
  await page.waitForTimeout(1200);
  const info = await page.evaluate(() => {
    const btn = document.querySelector('.node-inline-preview-btn');
    if (!btn) return { found:false };
    const chain = [];
    let cur = btn;
    while (cur) {
      const st = getComputedStyle(cur);
      chain.push({
        tag: cur.tagName,
        id: cur.id || '',
        cls: cur.className || '',
        display: st.display,
        visibility: st.visibility,
        opacity: st.opacity,
        hiddenAttr: cur.hasAttribute('hidden'),
        ariaHidden: cur.getAttribute('aria-hidden') || ''
      });
      cur = cur.parentElement;
      if (chain.length > 15) break;
    }
    return { found:true, chain };
  });
  console.log(JSON.stringify(info, null, 2));
});
