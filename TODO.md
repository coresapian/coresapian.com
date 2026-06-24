coresapian website refactor
Repository_Path="/Users/core/coresapian_inc/Codebases/Alfheim/coresapian"

- [ ] Remove any references to the temple that the end user sees when visiting the site. the browser tab should only say "coresapian inc.". The loading screen text should only read "coresapian inc." (keep the triangle logo) make the same triangle logo be the .ico icon for the tab bar as well as the google search results image (and the image when linking to social media like twitter so its displayed when someone links to my site). Any other place you find that temple references etc are clean them up as well, its not needed anymore and messes up my branding.
- [ ] add a llm to the chat window that users can @mention. use transformers.js so the model loads into the users browser and i dont have to serve it. use a SOTA model that runs in browser from huggingface, research that. be sure to lazy load the model so the websaite still runs while it loads in the users browser.
- [ ] commit this
- [ ] deploy to proxmox server
- [ ] publish live site.