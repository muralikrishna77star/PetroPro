export interface MessageTemplateVars {
  customerName: string;
  tenantName: string;
  billNo: number | string;
  amount: string;
}

/** Fills {customerName}/{tenantName}/{billNo}/{amount} placeholders in a Settings > Communication
 *  message template. Unknown placeholders are left as-is rather than stripped — a typo in a
 *  custom template should be visible to whoever wrote it, not silently swallowed. */
export function renderMessageTemplate(template: string, vars: MessageTemplateVars): string {
  return template
    .replaceAll("{customerName}", vars.customerName)
    .replaceAll("{tenantName}", vars.tenantName)
    .replaceAll("{billNo}", String(vars.billNo))
    .replaceAll("{amount}", vars.amount);
}
