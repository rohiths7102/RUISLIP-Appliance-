export async function writeAudit(db: any, e: { entityType: string; entityId: string; action: string; changedFields: string[]; previousValue: any; newValue: any; changedBy: string }) {
  await db.adminAuditLog.create({ data: { ...e } });
}
