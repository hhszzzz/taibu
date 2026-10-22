FROM alpine:3.22
RUN apk add --no-cache postgresql17-client restic tzdata su-exec \
  && addgroup -S backup && adduser -S -G backup backup \
  && mkdir -p /backups /data/files && chown -R backup:backup /backups
COPY backup.sh /usr/local/bin/backup.sh
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/backup.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
