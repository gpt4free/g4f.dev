## G4F - Additional Requirements

#### Introduction

You can install requirements partially or completely. So G4F can be used as you wish. You have the following options for this:

#### Options

Install g4f with all possible dependencies:
```
pip install -U g4f[all]
```
Install g4f with slim dependencies (without Browser):
```
pip install -U g4f[slim]
```
Install required packages for the Inference API:
```
pip install -U g4f[api]
```
Install required packages for the Web UI:
```
pip install -U g4f[gui]
```
Install required packages for uploading / generating images:
```
pip install -U g4f[image]
```
Install required package for proxy support with aiohttp:
```
pip install -U aiohttp_socks
```
Install required package for loading cookies from browser:
```
pip install browser_cookie3
```
Install all packages and uninstall this package for disabling the browser support:
```
pip uninstall nodriver 
```

---

[Return to Documentation](README.md)