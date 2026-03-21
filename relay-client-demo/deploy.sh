#!/bin/bash
scp -i ~/.ssh/oracle.key -r dist/* ubuntu@207.211.154.92:/var/www/demo/
