FROM postgres:17-alpine

RUN apk add --no-cache aws-cli ca-certificates
COPY deploy/backup/backup.sh /usr/local/bin/procurex-backup
RUN chmod 0555 /usr/local/bin/procurex-backup

ENTRYPOINT ["/usr/local/bin/procurex-backup"]
