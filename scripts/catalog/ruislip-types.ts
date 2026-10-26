/**
 * Our type for a model, anchored on Ruislip Appliances' own section and
 * category ("Venting Hobs (Built-In)"). Text alone misfiles these lines (spec
 * words like "TFT" sent Siemens hobs to Televisions), so words only choose
 * WITHIN the section's types, never outside them. null = not placed: skipped
 * and reported, never guessed.
 */
export function ruislipType(section: string, category: string, title: string): string | null {
  const t = `${title} ${category}`;
  const has = (re: RegExp) => re.test(t);
  const builtIn = /built[- ]?in|integrated|built[- ]?under/i.test(t);
  switch (section) {
    // A hood's title names its width or speeds; a filter or kit's does not ("73cm … Optional recirculation kit" is a hood).
    case "Hoods": return has(/filter|recirculat|kit|extension|duct|accessor/i) && !has(/\d{2,3}\s?cm|speed|canopy|island|telescopic|chimney hood|ceiling/i) ? "cooker-hood-accessories" : "cooker-hoods";
    case "Venting Hobs": return "venting-hobs";
    case "Hobs": return has(/vent/i) ? "venting-hobs" : has(/gas/i) ? "gas-hobs" : has(/induction/i) ? "hobs" : has(/ceramic|electric|radiant/i) ? "ceramic-hobs" : has(/wok|teppan|domino/i) ? "hobs" : null;
    case "Ovens": return has(/microwave/i) ? "built-in-microwaves" : has(/double/i) ? "double-ovens" : has(/built[- ]?under/i) ? "built-under-ovens" : has(/compact|45\s?cm/i) ? "compact-ovens" : "ovens";
    case "Combination": return has(/microwave/i) ? "built-in-microwaves" : "compact-ovens";
    case "Microwaves": return builtIn ? "built-in-microwaves" : "microwaves";
    case "Warming Drawers": case "Vacuum Drawer": return "warming-drawers";
    case "Dishwashers": {
      const slim = has(/slimline|45\s?cm/i);
      if (has(/semi[- ]?integrated/i)) return "semi-integrated-dishwashers";
      if (builtIn) return slim ? "integrated-slimline-dishwashers" : "integrated-dishwashers";
      return slim ? "slimline-dishwashers" : "freestanding-dishwashers";
    }
    case "Washing Machines": return builtIn ? "integrated-washing-machines" : "washing-machines";
    case "Washer Dryers": return builtIn ? "integrated-washer-dryers" : "washer-dryers";
    case "Dryers": return "tumble-dryers";
    case "American-Style": return "american-fridge-freezers";
    case "Wine Coolers": return "wine-coolers";
    case "Refrigeration": {
      if (has(/wine/i)) return "wine-coolers";
      if (has(/american|side[- ]by[- ]side|french door|multi[- ]door/i)) return "american-fridge-freezers";
      const ff = has(/fridge[- ]?freezer|combi|bottom freezer|\d+\/\d+/i);
      const freezer = !ff && has(/freezer/i);
      if (builtIn) return ff ? "integrated-fridge-freezers" : freezer ? "integrated-freezers" : "integrated-fridges";
      return ff ? "fridge-freezers" : freezer ? (has(/chest/i) ? "chest-freezers" : "freezers") : "fridges";
    }
    case "Coffee Machines": return has(/tassimo/i) ? "tassimo" : "bean-to-cup";
    case "Vacuum Cleaners": return has(/robot/i) ? "robot-vacuums" : has(/cordless|unlimited/i) ? "cordless-vacuums" : "vacuum-cleaners";
    case "Small Appliances": return has(/pan|pot|casserole|wok|cookware/i) ? "cookware" : has(/kettle/i) ? "kettles" : has(/toaster/i) ? "toasters" : has(/blend/i) ? "blenders" : has(/mixer|food processor|kitchen machine/i) ? "food-prep" : null;
    case "Accessories": return has(/pan|pot|casserole|cookware/i) ? "cookware" : has(/dock/i) ? "cooking-accessories" : has(/splash|tray|rail|shelf|rack/i) ? "cooking-accessories" : null;
    default: return null;
  }
}
