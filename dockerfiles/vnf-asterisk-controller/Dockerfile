FROM node:7.7
MAINTAINER @dougbtv
RUN npm install --silent -g grunt nodeunit nodemon
RUN git clone https://github.com/leifmadsen/vnf-asterisk-controller.git vac
WORKDIR /vac/
RUN npm install --silent
CMD /bin/bash
