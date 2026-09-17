server {
    listen 80;
    server_name admin.escrowglobal.io;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 9443 ssl;
    limit_req_status 429;
    server_name admin.escrowglobal.io;

    ssl_certificate /etc/letsencrypt/live/admin.escrowglobal.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/admin.escrowglobal.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Cache-Control "no-store" always;
    add_header X-Frame-Options "DENY" always;
    proxy_hide_header Content-Security-Policy;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" always;

    location = / {
        proxy_pass http://127.0.0.1:4174/admin;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /admin {
        proxy_pass http://127.0.0.1:4174/admin;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /admin/ {
        proxy_pass http://127.0.0.1:4174/admin;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /admin.html {
        proxy_pass http://127.0.0.1:4174/admin;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /admin.mjs {
        proxy_pass http://127.0.0.1:4174/admin.mjs;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /admin.css {
        proxy_pass http://127.0.0.1:4174/admin.css;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /brand-tokens.css {
        proxy_pass http://127.0.0.1:4174/brand-tokens.css;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /favicon.svg {
        proxy_pass http://127.0.0.1:4174/favicon.svg;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location ^~ /api/admin/ {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /api/custody/readiness {
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location / {
        return 404;
    }
}
