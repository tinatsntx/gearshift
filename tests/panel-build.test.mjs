import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { localPanel } from "../desktop/local-panel.mjs";
import { buildPanel,embedPanel } from "../scripts/panel-build.mjs";
test("panel embedding preserves dollar substitutions and escapes script closers",()=>{
  const script='const example = "$& $` $\' </script>";';
  const html=embedPanel('<html><script>/*GEARSHIFT_APP*/</script></html>',script);
  assert.ok(html.includes('$& $` $\''));assert.ok(html.includes('<\\/script>'));assert.equal(html.match(/<\/script>/g).length,1);
});
test("the official SDK panel bundle remains valid JavaScript after HTML embedding",async()=>{
  const html=await buildPanel('apps/panel/panel.mjs','apps/panel/panel.html');assert.ok(html.includes('Gearshift'));assert.ok(!html.includes('/*GEARSHIFT_APP*/'));
});
test("local panel inline script parses and opens with status only",()=>{
  const script=localPanel.match(/<script>([\s\S]*)<\/script>/)[1];assert.doesNotThrow(()=>new vm.Script(script));
  const calls=[],document={getElementById:()=>({textContent:"",value:"",checked:false})};
  vm.runInNewContext(script,{document,setInterval(){},fetch:async(url)=>{calls.push(url);return{ok:true,json:async()=>({routing_state:"off",routing_reason:"mode_off",passthrough_counts:{},recent:[]})};}});
  assert.deepEqual(calls,["/api/status"]);
});
