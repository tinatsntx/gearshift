import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listFolders } from "../desktop/folders.mjs";

test("Browse lists folders and directory links, with usable paths and no file contents",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"gearshift-folders-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,"Project 10"));await fs.mkdir(path.join(root,"Project 2"));
  await fs.mkdir(path.join(root,"café"));await fs.writeFile(path.join(root,"private-key.txt"),"must not be returned");
  await fs.symlink(path.join(root,"Project 2"),path.join(root,"Shortcut"),process.platform==="win32"?"junction":"dir");
  const result=await listFolders({path:root});
  assert.equal(result.path,root);assert.equal(result.parent,path.dirname(root));
  assert.deepEqual(result.folders.map(folder=>folder.name),["café","Project 2","Project 10","Shortcut"]);
  assert.ok(result.folders.every(folder=>path.isAbsolute(folder.path)));
  assert.ok(!JSON.stringify(result).includes("private-key"));
  const empty=await listFolders({path:path.join(root,"Project 2")});
  assert.equal(empty.parent,root);assert.deepEqual(empty.folders,[]);
});

test("Browse refuses files, relative paths and missing folders with visible error codes",async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"gearshift-folders-"));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,"file.txt");await fs.writeFile(file,"file");
  for(const asked of [file,"relative-folder",42,"bad\0path"]){
    await assert.rejects(listFolders({path:asked}),error=>error.code==="folder_invalid");
  }
  await assert.rejects(listFolders({path:path.join(root,"missing")}),error=>error.code==="folder_not_found");
});

test("a filesystem root has no parent to navigate beyond",async()=>{
  const root=path.parse(os.homedir()).root;
  assert.equal((await listFolders({path:root})).parent,null);
});
