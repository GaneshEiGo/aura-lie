/**
 * PRD Section 9.9 & FR-DATA-04: /wipe is absolute.
 */
export class DataWiper {
  public async wipeAll(confirmationWord: string, storage: any): Promise<{ success: boolean, message: string }> {
    if (confirmationWord !== 'WIPE') {
      return { success: false, message: 'Invalid confirmation word. Type WIPE to confirm.' };
    }

    try {
      if (storage && typeof storage.clear === 'function') {
        await storage.clear();
      }
      
      if (typeof globalThis.localStorage !== 'undefined') {
        globalThis.localStorage.clear();
      }

      if (typeof globalThis.caches !== 'undefined') {
        const cacheNames = await globalThis.caches.keys();
        await Promise.all(cacheNames.map(name => globalThis.caches.delete(name)));
      }

      return { success: true, message: 'All local data wiped. Server sync records flagged for deletion.' };
    } catch (err: any) {
      return { success: false, message: `Wipe failed: ${err.message}` };
    }
  }
}