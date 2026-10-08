import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export class FolderError extends Error {
  constructor(code) { super(code); this.code=code; }
}

// Directory names only, served through the helper's authenticated loopback API.
// A background helper cannot reliably display a native Windows dialog.
export async function listFolders(input={}) {
  const asked=input.path??os.homedir();
  if(typeof asked!=="string"||!asked.trim()||asked.includes("\0")||asked.length>32768||!path.isAbsolute(asked))throw new FolderError("folder_invalid");
  const current=path.resolve(asked);
  try {
    if(!(await fs.stat(current)).isDirectory())throw new FolderError("folder_invalid");
    const entries=await fs.readdir(current,{withFileTypes:true});
    const folders=(await Promise.all(entries.map(async entry=>{
      const child=path.join(current,entry.name);
      if(entry.isDirectory())return {name:entry.name,path:child};
      if(entry.isSymbolicLink())try{if((await fs.stat(child)).isDirectory())return {name:entry.name,path:child};}catch{}
      return null;
    }))).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:"base"}));
    const parent=path.dirname(current);
    return {path:current,parent:parent===current?null:parent,home:os.homedir(),folders};
  } catch(error) {
    if(error instanceof FolderError)throw error;
    throw new FolderError(error.code==="ENOENT"||error.code==="ENOTDIR"?"folder_not_found":"folder_unreadable");
  }
}
