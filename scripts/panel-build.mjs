import fs from "node:fs";
import vm from "node:vm";
import { build } from "esbuild";
export function embedPanel(template,script){
  const escaped=script.replace(/<\/script/gi,"<\\/script");
  // A replacement function preserves literal $&, $` and $' in SDK bundles.
  const html=template.replace("/*GEARSHIFT_APP*/",()=>escaped);
  const inline=html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
  if(!inline)throw Error("panel_script_missing");
  new vm.Script(inline); // Validate the final embedding, not just the bundle.
  return html;
}
export async function buildPanel(entryPoint,template){
  const ui=await build({entryPoints:[entryPoint],bundle:true,write:false,format:"iife",platform:"browser",target:"es2022",minify:true});
  return embedPanel(fs.readFileSync(template,"utf8"),ui.outputFiles[0].text);
}
