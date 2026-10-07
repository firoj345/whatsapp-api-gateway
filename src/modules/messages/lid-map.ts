import { logger } from '../../infra/logger.js';

class LidMap {
  private pnToLid = new Map<string, string>();
  private lidToPn = new Map<string, string>();

  register(lid: string, pn: string) {
    if (!lid || !pn) return;
    const cleanPn = pn.replace(/[^0-9]/g, '');
    this.pnToLid.set(cleanPn, lid);
    this.pnToLid.set(`${cleanPn}@s.whatsapp.net`, lid);
    this.lidToPn.set(lid, `${cleanPn}@s.whatsapp.net`);
    logger.debug({ lid, pn: cleanPn }, 'Registered LID <-> Phone mapping');
  }

  getLid(pnOrJid: string): string | undefined {
    if (pnOrJid.endsWith('@lid')) return pnOrJid;
    const clean = pnOrJid.replace(/[^0-9]/g, '');
    return this.pnToLid.get(clean) || this.pnToLid.get(pnOrJid);
  }

  getPn(lid: string): string | undefined {
    return this.lidToPn.get(lid);
  }

  getCanonicalJid(jid: string, phoneJid?: string): string {
    if (!jid.endsWith('@lid')) return jid;
    const mappedPhone = phoneJid || this.getPn(jid);
    if (!mappedPhone) return jid;
    const digits = mappedPhone.replace(/[^0-9]/g, '');
    return digits ? `${digits}@s.whatsapp.net` : mappedPhone;
  }
}

export const lidMap = new LidMap();
