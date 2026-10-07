#!/usr/bin/env python3
"""Sella la versión (hora de Argentina) en index.html y version.json. Correr antes de cada commit."""
import re, json, datetime
v=(datetime.datetime.utcnow()-datetime.timedelta(hours=3)).strftime("%Y%m%d-%H%M")
p="index.html"; c=open(p,encoding="utf-8").read()
c,n=re.subn(r'const APP_VERSION = "[^"]*";', f'const APP_VERSION = "{v}";', c); assert n==1
open(p,"w",encoding="utf-8").write(c)
json.dump({"version":v}, open("version.json","w"))
print("versión:",v)
