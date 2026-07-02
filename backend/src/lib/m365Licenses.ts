// Licenças do M365 que dão direito de acesso ao APROVA (requisito do CEO):
// Business Basic (O365_BUSINESS_ESSENTIALS) e Business Standard/Premium
// (O365_BUSINESS_PREMIUM). Qualquer outra licença (ou nenhuma) NÃO habilita.
export const ELIGIBLE_SKU_IDS = [
  '3b555118-da6a-4418-894f-7df1e2096870', // O365_BUSINESS_ESSENTIALS (Business Basic)
  'f245ecc8-75af-4f8e-b61f-27d8114de5f3', // O365_BUSINESS_PREMIUM (Business Standard/Premium)
] as const;

export function hasEligibleLicense(assignedLicenses: { skuId: string }[] | null | undefined): boolean {
  if (!assignedLicenses || assignedLicenses.length === 0) return false;
  return assignedLicenses.some((l) => (ELIGIBLE_SKU_IDS as readonly string[]).includes(l.skuId));
}
