import { HAConnection, HAConfig } from '../shared/ha-api';

export class BrowserHAConnection implements HAConnection {
  private ws: WebSocket | null = null;
  private config: HAConfig;
  private id = 1;
  private pendingRequests = new Map<number, { resolve: (value: any) => void, reject: (reason: any) => void }>();

  constructor(config: HAConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;

    return new Promise((resolve, reject) => {
      const url = this.config.url.replace(/^http/, 'ws') + '/api/websocket';
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        // Wait for auth_required
      };

      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'auth_required') {
          this.ws!.send(JSON.stringify({ type: 'auth', access_token: this.config.token }));
        } else if (msg.type === 'auth_ok') {
          resolve();
        } else if (msg.type === 'auth_invalid') {
          reject(new Error(msg.message));
          this.ws?.close();
        } else if (msg.type === 'result') {
          const handler = this.pendingRequests.get(msg.id);
          if (handler) {
            if (msg.success) {
              handler.resolve(msg.result);
            } else {
              handler.reject(new Error(msg.error.message));
            }
            this.pendingRequests.delete(msg.id);
          }
        }
      };

      this.ws.onerror = (error) => {
        reject(error);
      };
      
      this.ws.onclose = () => {
          this.ws = null;
      };
    });
  }

  async callService(domain: string, service: string, data?: Record<string, any>): Promise<any> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({
        id,
        type: 'call_service',
        domain,
        service,
        service_data: data
      }));
    });
  }

  async getStates(): Promise<any[]> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({
        id,
        type: 'get_states'
      }));
    });
  }

  async getServices(): Promise<any> {
    await this.connect();
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pendingRequests.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({
        id,
        type: 'get_services'
      }));
    });
  }

  async setState(entityId: string, state: string, attributes?: any): Promise<any> {
    const url = this.config.url.replace(/^ws/, 'http') + `/api/states/${entityId}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state,
        attributes
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to set state: ${response.statusText}`);
    }
    
    return response.json();
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
