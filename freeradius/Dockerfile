FROM freeradius/freeradius-server:latest

# Install PostgreSQL client library for rlm_sql_postgresql
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    freeradius-postgresql \
    freeradius-ldap \
    postgresql-client \
    winbind \
    && rm -rf /var/lib/apt/lists/*

# Add winbindd_priv group with host GID 986 and add freerad user to it
RUN groupadd -g 986 winbindd_priv || true && usermod -a -G winbindd_priv freerad || true

# Copy custom configuration files
COPY radiusd.conf /etc/freeradius/radiusd.conf
COPY clients.conf /etc/freeradius/clients.conf
COPY mods-available/sql /etc/freeradius/mods-available/sql
COPY mods-available/ldap /etc/freeradius/mods-available/ldap
COPY mods-available/mschap /etc/freeradius/mods-available/mschap
COPY sites-available/default /etc/freeradius/sites-available/default
COPY sites-available/inner-tunnel /etc/freeradius/sites-available/inner-tunnel

# Enable SQL and MSCHAP modules (create symlinks)
RUN ln -sf /etc/freeradius/mods-available/sql /etc/freeradius/mods-enabled/sql \
    && ln -sf /etc/freeradius/mods-available/mschap /etc/freeradius/mods-enabled/mschap

# Copy entrypoint script that substitutes env vars
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 1812/udp 1813/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeradius", "-f", "-l", "stdout"]
