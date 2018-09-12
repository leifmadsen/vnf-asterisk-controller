FROM nginx:latest
MAINTAINER @dougbtv
ENV BUILD_DATE 2018-09-11
RUN apt-get update && apt-get install --no-install-recommends --no-install-suggests -y git
# Hrmmm to build from the lab I needed the env.
RUN env GIT_SSL_NO_VERIFY=true git clone https://github.com/leifmadsen/vnf-asterisk-controller.git vac
ADD nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
