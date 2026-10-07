import test from "node:test";
import assert from "node:assert/strict";
import { buildPanel,embedPanel } from "../scripts/panel-build.mjs";
test("panel embedding preserves dollar substitutions and escapes script closers",()=>{
  const script='const example = "$& $` $\' </script>";';
  const html=embedPanel('<html><script>/*GEARSHIFT_APP*/</script></html>',script);
  assert.ok(html.includes('$& $` $\''));assert.ok(html.includes('<\\/script>'));assert.equal(html.match(/<\/script>/g).length,1);
});
test("the official SDK panel bundle remains valid JavaScript after HTML embedding",async()=>{
  const html=await buildPanel('apps/panel/panel.mjs','apps/panel/panel.html');assert.ok(html.includes('Gearshift'));assert.ok(!html.includes('/*GEARSHIFT_APP*/'));
});
