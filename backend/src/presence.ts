import type { Identity, Role } from './types';

type Status = 'online' | 'offline';
class Presence {
  readonly connections: Map<string, { role: Role; id: string; status: Status }>;
  constructor() {
    this.connections = new Map();
  }

  connect(socketId: string, identity: Pick<Identity, 'role' | 'id'>, requestedStatus: unknown = 'online') {
    const existing = [...this.connections.values()].find(value => value.role === identity.role && value.id === identity.id);
    const status = existing?.status || (requestedStatus === 'offline' ? 'offline' : 'online');
    this.connections.set(socketId, { role: identity.role, id: identity.id, status });
    return status;
  }

  setStatus(agentId: string, status: Status) {
    const sockets = [];
    for (const [socketId, identity] of this.connections) {
      if (identity.role === 'agent' && identity.id === agentId) {
        identity.status = status;
        sockets.push(socketId);
      }
    }
    return sockets;
  }

  disconnect(socketId: string) {
    const identity = this.connections.get(socketId);
    this.connections.delete(socketId);
    return identity && ![...this.connections.values()].some(value => value.role === identity.role && value.id === identity.id) ? identity : null;
  }

  availability() {
    return { online: [...this.connections.values()].some(value => value.role === 'agent' && value.status === 'online') };
  }

  isOnline(agentId: string) {
    return [...this.connections.values()].some(value => value.role === 'agent' && value.id === agentId && value.status === 'online');
  }

  onlineVisitors(visitorIds: string[]) {
    const online = new Set([...this.connections.values()].filter(value => value.role === 'visitor').map(value => value.id));
    return visitorIds.filter(id => online.has(id));
  }
}

export { Presence };
