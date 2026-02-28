
export interface HAServiceCall {
  domain: string;
  service: string;
  data?: Record<string, any>;
}

export interface HAConnection {
  callService(domain: string, service: string, data?: Record<string, any>): Promise<any>;
  getStates(): Promise<HAEntity[]>;
  getServices(): Promise<HAServices>;
  setState?(entityId: string, state: string, attributes?: any): Promise<any>;
  disconnect?(): void;
}

export interface HAEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, any>;
  last_changed: string;
  last_updated: string;
  context: any;
}

export interface HAServices {
  [domain: string]: {
    [service: string]: {
      name?: string;
      description?: string;
      fields?: Record<string, any>;
      target?: any;
    }
  }
}

export function parseServiceId(serviceId: string): { domain: string, service: string } {
  const parts = serviceId.split('.');
  if (parts.length !== 2) {
    throw new Error(`Invalid service ID: ${serviceId}`);
  }
  return { domain: parts[0], service: parts[1] };
}

export interface HAConfig {
  url: string;
  token: string;
}
