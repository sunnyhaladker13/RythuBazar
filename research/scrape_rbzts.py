"""Crawl every Rythu Bazar on http://183.82.5.184/rbzts/ and dump today's rates to rbzts_snapshot.json.
Prototype from the 2026-10-07 source research; see ../RESEARCH.md."""
import re, html, urllib.request, urllib.parse, http.cookiejar, json, time
BASE="http://183.82.5.184/rbzts/HomePage.aspx"
op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
FAILS=[0]
def get(data=None):
    if data: data=urllib.parse.urlencode(data).encode()
    for a in range(4):
        try:
            time.sleep(1.0)
            return op.open(urllib.request.Request(BASE,data,headers={"User-Agent":"Mozilla/5.0"}),timeout=45).read().decode('utf-8','ignore')
        except Exception as e:
            FAILS[0]+=1; print("  retry",a,e,flush=True); time.sleep(5*(a+1))
    raise SystemExit("server unreachable")
def hidden(s): return {m.group(1):html.unescape(m.group(2)) for m in re.finditer(r'<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"',s)}
def opts(s,name):
    m=re.search(r'name="'+re.escape(name)+r'".*?</select>',s,re.S)
    return [(v,t.strip()) for v,t in re.findall(r'<option[^>]*value="([^"]*)"[^>]*>([^<]*)</option>',m.group(0)) if v.isdigit()] if m else []
def grid(s):
    m=re.search(r'id="ctl00_ContentPlaceHolder1_GridView1".*?</table>',s,re.S)
    if not m: return None
    rows=[[html.unescape(re.sub(r'<[^>]+>','',c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>',r,re.S)] for r in re.findall(r'<tr.*?</tr>',m.group(0),re.S)]
    return [r for r in rows if len(r)==2 and r[0]!='Vegetable']
D="ctl00$ContentPlaceHolder1$ddlDist"; R="ctl00$ContentPlaceHolder1$ddlRbz"
home=get(); out={}; t0=time.time()
for dv,dn in opts(home,D):
    h=hidden(home); h.update({"__EVENTTARGET":D,"__EVENTARGUMENT":"",D:dv}); s=get(h)
    for rv,rn in opts(s,R):
        h2=hidden(s); h2.update({"__EVENTTARGET":R,"__EVENTARGUMENT":"",D:dv,R:rv})
        g=grid(get(h2)); out[f"{dn} / {rn}"]=g
        print(f"{dn:28s} {rn:30s} {len(g) if g else 0}",flush=True)
json.dump(out,open("rbzts_snapshot.json","w"),indent=1)
print("fails",FAILS[0]);print("total markets",len(out),"with data",sum(1 for v in out.values() if v),"secs",round(time.time()-t0))
