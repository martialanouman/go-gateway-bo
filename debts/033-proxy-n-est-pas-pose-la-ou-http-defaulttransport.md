# 033 — `Proxy` n'est pas posé, là où `http.DefaultTransport` pose `ProxyFromEnvironment`

> **Porteur :** step-060

## Ce qu'elle coûte si elle dure

Divergence silencieuse d'avec le défaut : un `HTTPS_PROXY` d'environnement est ignoré sans que rien ne le dise.
