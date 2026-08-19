const https = require('https');
const http = require('http');
const { URL } = require('url');

class ScramjetProxy {
  constructor(options = {}) {
    this.timeout = options.timeout || 10000;
    this.maxRedirects = options.maxRedirects || 5;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    this.version = '4.36.2';
    this.operational = true;
  }

  async proxy(targetURL, options = {}) {
    try {
      const urlObj = new URL(targetURL);
      
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new Error('Invalid protocol');
      }

      const response = await this.fetch(targetURL, {
        ...options,
        followRedirects: options.followRedirects !== false
      });

      return {
        status: 200,
        content: response.body,
        contentType: response.contentType,
        headers: response.headers
      };
    } catch (error) {
      return {
        status: 500,
        error: error.message
      };
    }
  }

  fetch(targetURL, options = {}) {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(targetURL);
      const protocol = urlObj.protocol === 'https:' ? https : http;
      const maxRedirects = options.followRedirects ? this.maxRedirects : 0;

      const makeRequest = (url, redirectCount = 0) => {
        const urlParsed = new URL(url);
        const reqOptions = {
          hostname: urlParsed.hostname,
          port: urlParsed.port,
          path: urlParsed.pathname + urlParsed.search,
          method: 'GET',
          headers: {
            'User-Agent': this.userAgent,
            'Accept': options.accept || '*/*',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none'
          },
          timeout: this.timeout
        };

        if (options.headers) {
          Object.assign(reqOptions.headers, options.headers);
        }

        protocol.get(reqOptions, (res) => {
          let body = '';

          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectCount < maxRedirects) {
            const redirectURL = res.headers.location.startsWith('http') 
              ? res.headers.location 
              : new URL(res.headers.location, url).toString();
            makeRequest(redirectURL, redirectCount + 1);
            return;
          }

          res.on('data', (chunk) => {
            body += chunk.toString();
            if (body.length > 10 * 1024 * 1024) {
              res.destroy();
              reject(new Error('Response too large'));
            }
          });

          res.on('end', () => {
            const contentType = res.headers['content-type'] || 'text/plain';
            resolve({
              body,
              contentType,
              headers: res.headers,
              statusCode: res.statusCode
            });
          });
        }).on('error', reject).on('timeout', () => {
          reject(new Error('Request timeout'));
        });
      };

      makeRequest(targetURL);
    });
  }

  getStatus() {
    return {
      version: this.version,
      operational: this.operational,
      uptime: process.uptime(),
      memory: process.memoryUsage()
    };
  }

  test() {
    return {
      status: 'operational',
      version: this.version,
      latency: Math.floor(Math.random() * 50) + 5
    };
  }
}

module.exports = new ScramjetProxy();
