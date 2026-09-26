import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
const source=await readFile(new URL('../marketplace/build/build.js',import.meta.url),'utf8')
const definition=source.slice(source.indexOf('function parseDshContract('),source.indexOf('async function loadCatalogDshContract('))
const context=vm.createContext({})
vm.runInContext(source.match(/const TAG_PATTERN = [^\n]+/)[0]+';\n'+definition+'\nthis.tag = value => TAG_PATTERN.test(value);this.parse = parseCatalogDshContract',context)
test('download page accepts semver and old date releases without accepting arbitrary refs',()=>{
 for(const value of ['v0.5.0','v2026.08.16','v2026.08.16.1'])assert.equal(context.tag(value),true)
 for(const value of ['main','v0.5.0/../../main','v0.5.0-rc.1','v0.5'])assert.equal(context.tag(value),false)
})
test('DSH adapter readiness requires exactly one matching approved fixed-source Catalog identity',()=>{
 const entry={id:'build-dsh-plugin',status:'approved',version:'0.5.0',repositoryUrl:'https://github.com/AI-Scarlett/build-dsh-plugin',packageName:'dsh-build-plugin',commit:'a'.repeat(40),manifestPath:'package.json',installPath:null,entryIds:['dsh-build-plugin-skill-provider'],compatibility:{dshReleases:{'0.1.5-rc.2':'compatible'}}}
 const catalog={schemaVersion:1,registry:{repositoryUrl:'https://github.com/AI-Scarlett/DSH-Store'},entries:[entry]}
 const manifest={distributionVersion:'0.5.0'}
 assert.equal(context.parse(catalog,manifest).installSpecifier,'git+https://github.com/AI-Scarlett/build-dsh-plugin.git#'+'a'.repeat(40))
 for(const patch of [{status:'unlisted'},{version:'0.4.4'},{repositoryUrl:'https://github.com/other/repo'},{commit:'main'},{installPath:'elsewhere'},{entryIds:['official']},{compatibility:{dshReleases:{'0.1.5-rc.2':'unknown'}}}])assert.equal(context.parse({...catalog,entries:[{...entry,...patch}]},manifest),null)
 assert.equal(context.parse({...catalog,entries:[entry,entry]},manifest),null)
})
