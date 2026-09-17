server {
    listen 80;
    limit_req_status 429;
    server_name escrowglobal.io www.escrowglobal.io;

    location ^~ /.well-known/acme-challenge/ {
        root /var/www/letsencrypt;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 9443 ssl;
    limit_req_status 429;
    server_name escrowglobal.io www.escrowglobal.io;

    ssl_certificate /etc/letsencrypt/live/escrowglobal.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/escrowglobal.io/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    root /var/www/escrowglobal.io;
    index index.html;

    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location = /api/analytics/event {
        if ($request_method !~ ^(POST|OPTIONS)$) { return 405; }
        if ($escrow_cors_origin = "") { return 403; }

        add_header Access-Control-Allow-Origin $escrow_cors_origin always;
        add_header Access-Control-Allow-Methods "POST, OPTIONS" always;
        add_header Access-Control-Allow-Headers "Content-Type" always;
        add_header Access-Control-Max-Age 600 always;
        add_header Vary "Origin" always;
        add_header X-Content-Type-Options "nosniff" always;

        if ($request_method = OPTIONS) { return 204; }

        limit_req zone=escrow_public_ip burst=30 nodelay;
        client_max_body_size 16k;

        proxy_pass http://127.0.0.1:4174/api/analytics/event;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_set_header Origin $http_origin;
        proxy_hide_header Server;
        access_log off;
    }

    location = /api/chat/session {
        if ($request_method !~ ^(GET)$) { return 405; }
        limit_req zone=escrow_chat_ip burst=20 nodelay;
        client_max_body_size 16k;

        proxy_pass http://127.0.0.1:4174/api/chat/session;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /api/chat/messages {
        if ($request_method !~ ^(POST)$) { return 405; }
        limit_req zone=escrow_chat_ip burst=20 nodelay;
        client_max_body_size 16k;

        proxy_pass http://127.0.0.1:4174/api/chat/messages;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location ^~ /api/ {
        return 404;
    }

    location = /visitor-tools.mjs {
        types { }
        default_type application/javascript;
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }

    location = /visitor-tools.css {
        default_type text/css;
        add_header Cache-Control "no-cache" always;
        add_header X-Content-Type-Options "nosniff" always;
        try_files $uri =404;
    }

    location = /admin {
        return 302 https://admin.escrowglobal.io/admin;
    }

    location = /admin/ {
        return 302 https://admin.escrowglobal.io/admin;
    }

    location = /admin.html {
        return 302 https://admin.escrowglobal.io/admin;
    }

    location = /blog {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host 127.0.0.1:4174;
    }

    location ^~ /blog/ {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host 127.0.0.1:4174;
    }

    location = /blog.mjs {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host 127.0.0.1:4174;
    }

    location = /blog.css {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_set_header Host 127.0.0.1:4174;
    }

    location = /api/blog {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174/api/blog;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location ^~ /api/blog/ {
        limit_except GET { deny all; }
        proxy_pass http://127.0.0.1:4174;
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:4174;
        proxy_set_header X-Escrow-Client-IP $remote_addr;
        proxy_set_header X-Escrow-Country $escrow_geo_country;
        proxy_hide_header Server;
    }

    location = /support {
        return 302 https://www.escrowglobal.io/?chat=1;
    }

    location = /support/ {
        return 302 https://www.escrowglobal.io/?chat=1;
    }

    location = /healthz {
        default_type text/plain;
        return 200 "ok\n";
    }

    location ~ /\. { return 404; }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
