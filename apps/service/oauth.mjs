import { InvalidGrantError,InvalidTokenError,InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { opaque,hash } from "./control.mjs";
export class GithubOAuth {
  constructor(store,{baseUrl,clientId,clientSecret,fetcher=fetch,now=Date.now}){
    Object.assign(this,{store,baseUrl,clientId,clientSecret,fetcher,now});
    this.clientsStore={getClient:id=>store.transaction(s=>s.clients[id]),registerClient:client=>store.transaction(s=>{if(client.token_endpoint_auth_method!=="none")throw new InvalidRequestError("Public PKCE clients only");if(client.redirect_uris.some(uri=>{const u=new URL(uri);return u.protocol!=="https:"&&!(["localhost","127.0.0.1","[::1]"].includes(u.hostname)&&u.protocol==="http:");}))throw new InvalidRequestError("HTTPS redirect required");const id=opaque();return s.clients[id]={...client,client_id:id,client_id_issued_at:Math.floor(now()/1000)};})};
  }
  validate(params){if(!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))throw new InvalidRequestError("S256 required");if(params.resource?.toString()!==`${this.baseUrl}/mcp`)throw new InvalidRequestError("Resource must match Gearshift MCP");if((params.scopes??[]).some(s=>s!=="gearshift"))throw new InvalidRequestError("Unsupported scope");}
  async authorize(client,params,res){this.validate(params);const state=await this.flow({kind:"oauth",client:client.client_id,params:{...params,resource:params.resource.toString()}});res.redirect(this.githubUrl(state));}
  githubUrl(state){if(!this.clientId||!this.clientSecret)throw new InvalidRequestError("GitHub sign-in setup pending");const u=new URL("https://github.com/login/oauth/authorize");u.search=new URLSearchParams({client_id:this.clientId,redirect_uri:`${this.baseUrl}/github/callback`,scope:"read:user",state}).toString();return u.toString();}
  async flow(value){const state=opaque();await this.store.transaction(s=>{s.flows[hash(state)]={...value,expires:this.now()+300000};});return state;}
  async callback(state,code){
    const flow=await this.store.transaction(s=>{const f=s.flows[hash(state)];if(!f||f.expires<=this.now())throw new InvalidGrantError("Sign-in expired");delete s.flows[hash(state)];return f;});
    const response=await this.fetcher("https://github.com/login/oauth/access_token",{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify({client_id:this.clientId,client_secret:this.clientSecret,code,redirect_uri:`${this.baseUrl}/github/callback`}),signal:AbortSignal.timeout(10000)});
    const result=await response.json();if(!response.ok||!result.access_token)throw new InvalidGrantError("GitHub sign-in failed");
    // GitHub token is used only for identity and never saved or returned.
    const info=await this.fetcher("https://api.github.com/user",{headers:{Authorization:`Bearer ${result.access_token}`,Accept:"application/vnd.github+json","User-Agent":"Gearshift"},signal:AbortSignal.timeout(10000)});const user=await info.json();if(!info.ok||!Number.isSafeInteger(user.id))throw new InvalidGrantError("Identity unavailable");
    const id=`github:${user.id}`;await this.store.transaction(s=>{s.users[id]={id};});
    return {flow,user:id};
  }
  async completeOAuth(flow,user){const code=opaque();await this.store.transaction(s=>{s.codes[hash(code)]={client:flow.client,user,params:flow.params,expires:this.now()+60000};});const u=new URL(flow.params.redirectUri);u.searchParams.set("code",code);if(flow.params.state)u.searchParams.set("state",flow.params.state);return u.toString();}
  async challengeForAuthorizationCode(client,code){return this.store.transaction(s=>{const c=s.codes[hash(code)];if(!c||c.client!==client.client_id||c.expires<=this.now())throw new InvalidGrantError("Code invalid");return c.params.codeChallenge;});}
  async exchangeAuthorizationCode(client,code,_verifier,redirectUri,resource){return this.store.transaction(s=>{const c=s.codes[hash(code)];if(!c||c.client!==client.client_id||c.expires<=this.now()||redirectUri!==c.params.redirectUri||resource?.toString()!==c.params.resource)throw new InvalidGrantError("Code invalid");delete s.codes[hash(code)];const access=opaque();s.tokens[hash(access)]={user:c.user,client:client.client_id,resource:c.params.resource,expires:this.now()+3600000};return {access_token:access,token_type:"Bearer",expires_in:3600,scope:"gearshift"};});}
  async exchangeRefreshToken(){throw new InvalidGrantError("Sign in again");}
  async verifyAccessToken(token){return this.store.transaction(s=>{const t=s.tokens[hash(token)];if(!t||t.expires<=this.now()||t.resource!==`${this.baseUrl}/mcp`)throw new InvalidTokenError("Token invalid");return {token,clientId:t.client,scopes:["gearshift"],expiresAt:Math.floor(t.expires/1000),resource:new URL(t.resource),extra:{user:t.user}};});}
  async revokeToken(client,{token}){await this.store.transaction(s=>{if(s.tokens[hash(token)]?.client===client.client_id)delete s.tokens[hash(token)];});}
}
