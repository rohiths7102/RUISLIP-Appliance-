/**
 * Delivery, installation and disposal prices — Sachin's list (email, 30 Sept
 * 2026). One list: the Delivery & Services page shows it in full, the town
 * pages under their delivery / fitting / recycling cards, the town × department
 * pages the lines for that department. `depts` names the departments a line
 * applies to (LOCAL_DEPARTMENTS ids in lib/areas.ts); no `depts` = every one.
 */
export type ServicePrice = { what: string; price: string; depts?: string[] };

export const SERVICE_PRICES: { heading: string; items: ServicePrice[] }[] = [
  { heading: "Delivery & installation", items: [
    { what: "Ground-floor installation of a freestanding washing machine or dishwasher, with free local delivery up to 3 miles from HA4 0QP", price: "£40", depts: ["laundry", "dishwashers"] },
    { what: "Delivery more than 3 miles from HA4 0QP", price: "£20" },
    { what: "Upstairs delivery, up to 2 flights of stairs", price: "£30" },
    { what: "Tumble dryer set-up", price: "£25", depts: ["laundry"] },
    { what: "Fridge or freezer set-up", price: "£35", depts: ["refrigeration"] },
  ] },
  { heading: "Integrated & built-in", items: [
    { what: "Integrated washing machine, dishwasher, dryer, fridge freezer, fridge or freezer", price: "£120", depts: ["laundry", "dishwashers", "refrigeration"] },
    { what: "Built-in single oven", price: "£95", depts: ["cooking"] },
    { what: "Built-in or built-under double oven", price: "£115", depts: ["cooking"] },
    { what: "Built-in electric hob", price: "£115", depts: ["cooking"] },
    { what: "Gas appliances", price: "from £150", depts: ["cooking"] },
    { what: "American fridge freezers", price: "Call to discuss", depts: ["refrigeration"] },
  ] },
  { heading: "Taking the old one away", items: [
    { what: "Disposal of your old appliance, and the packaging taken away from the new one", price: "£30", depts: ["laundry", "dishwashers", "cooking"] },
    { what: "Disposal of an old fridge or freezer", price: "£35", depts: ["refrigeration"] },
  ] },
];

/** The list, or just the lines for one department. */
export const servicePricesFor = (dept?: string) =>
  SERVICE_PRICES.map((g) => ({ ...g, items: g.items.filter((i) => !dept || !i.depts || i.depts.includes(dept)) }))
    .filter((g) => g.items.length);
