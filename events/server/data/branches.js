// ---------------------------------------------------------------------------
// Joya branch data — content lifted from the individual branch pages on
// joya.co.il (text in Hebrew, verbatim where possible; images downloaded to
// /images/joya/branches/<slug>/). Used by the /joya/branches/:slug pages and
// the /joya branch list.
//
// Note: joya.co.il has no dedicated pages for הרצליה or פסקרה איטלי, but does
// have a מודיעין branch — so this list reflects the 9 real branch pages.
//
// When the admin backend takes over, this static data can move to the DB.
// ---------------------------------------------------------------------------

const img = (slug, n) => `/images/joya/branches/${slug}/${String(n).padStart(2, "0")}.jpg`;
const gallery = (slug) => [1, 2, 3, 4, 5].map((n) => img(slug, n));

export const BRANCHES = [
  {
    slug: "tel-aviv",
    name: "ג׳ויה תל אביב",
    city: "תל אביב",
    kosher: false,
    address: "הברזל 4, תל אביב",
    phone: "03-6447031",
    description: [
      "בג׳ויה תל אביב, כמו בכל סניפי רשת ג׳ויה, תפגשו בעיקר שמחת חיים אשר כל כך אופיינית לעם האיטלקי, ולצידה את נפלאות המטבח של ארץ המגף.",
      "עיצוב חמים ועשיר באלמנטים עשויי עץ, שירות לבבי ועם זאת מקצועי ללא פשרות.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ש׳ 12:00–23:00" },
      { label: "משלוחים", value: "א׳–ה׳ 12:00–22:30 · ו׳–שבת 12:00–21:30" },
      { label: "עסקית צהריים", value: "א׳–ה׳ 12:00–17:00" },
    ],
    links: {
      menu: "https://joya.co.il/wp-content/uploads/2025/12/תפריט-גויה-גיסין-פתח-תקווה-7.6.pdf",
      reserve: "https://ontopo.co.il/joyatlv?source=homepage",
      waze: "https://waze.com/ul/hsv8y8syg2",
      order: "https://joya.m-secured.co.il/he_IL/branches/3714/order-online#menu/now",
    },
    images: gallery("tel-aviv"),
  },
  {
    slug: "raanana",
    name: "ג׳ויה רעננה",
    city: "רעננה",
    kosher: false,
    address: "שדרות ירושלים 34, רעננה",
    phone: "077-9800536",
    description: [
      "בג׳ויה רעננה מחברים בהצלחה עולם ישן ועולם חדש — מורשת איטלקית מסורתית לצד עיצוב עכשווי.",
      "המטבח, בהשראת אמן הפיצה מקלבריה טומאסו רוג׳רו, משלב טכניקות איטלקיות קלאסיות עם הגשה מודרנית, לצד תנור מרכזי ומרפסת עשירה בעשבי תיבול.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ש׳ 12:00–23:00" },
      { label: "עסקית צהריים", value: "א׳–ה׳ 12:00–17:00 · 15% הנחה" },
    ],
    links: {
      menu: "https://joya.co.il/תפריט-רעננה/",
      reserve: "https://ontopo.co.il/joyaraanana?source=homepage",
      waze: "https://waze.com/ul/hsv8z15k0r",
    },
    images: gallery("raanana"),
  },
  {
    slug: "petah-tikva",
    name: "ג׳ויה פתח תקווה",
    city: "פתח תקווה",
    kosher: false,
    address: "אבשלום גיסין 17, פתח תקווה",
    phone: "077-9386459",
    description: [
      "ג׳ויה פתח תקווה הצטרפה לסניפי הרשת בשנת 2022 ומתאפיינת גם היא בשמחת החיים האיטלקית.",
      "המסעדה מעוצבת בתאורה רכה ובאווירה חמימה ומשפחתית, אך עם זאת אלגנטית ומוקפדת, ומגובה בשירות מקצועני.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ש׳ 12:00–23:00" },
      { label: "עסקית צהריים", value: "א׳–ה׳ 12:00–17:00 · 15% הנחה" },
    ],
    links: {
      menu: "https://joya.co.il/wp-content/uploads/2026/02/תפריט-גויה-גיסין-פתח-תקווה-2.17.pdf",
      reserve: "https://ontopo.co.il/joyapt?source=homepage",
      waze: "https://waze.com/ul/hsv8y9g0zn",
      order: "https://wolt.com/he/isr/petah-tikva/restaurant/joya-petah-tikva",
    },
    images: gallery("petah-tikva"),
  },
  {
    slug: "modiin",
    name: "ג׳ויה מודיעין",
    city: "מודיעין",
    kosher: false,
    address: "מתתיהו הכהן 1, מודיעין",
    phone: "077-9386304",
    description: [
      "תושבי מודיעין והסביבה, יש לנו חדשות משמחות — ג׳ויה מודיעין פתוחה!",
      "מחכים לכם כל יום מהשעה 12:00 ועד 23:00 עם המנות הטעימות שלנו, הדרינקים המעולים והאווירה המחשמלת.",
    ],
    hours: [
      { label: "מסעדה", value: "כל יום 12:00–23:00" },
      { label: "עסקית צהריים", value: "א׳–ה׳ 12:00–17:00 · 15% הנחה" },
    ],
    links: {
      menu: "https://joya.co.il/תפריט-מודיעין/",
      reserve: "https://ontopo.com/he/il/page/89798592?source=homepage",
      waze: "https://waze.com/ul/hsv8vkxf4w",
      order: "https://orders.beecommcloud.com/#/sites/p-0/62f48c2a7f9095f113a7add3",
    },
    images: gallery("modiin"),
  },
  {
    slug: "netanya",
    name: "ג׳ויה עיר ימים נתניה",
    city: "נתניה",
    kosher: true,
    kosherText: "חלבי ודגים — כשר",
    address: "מתחם פיאנו עיר ימים, שושנה דמארי 10, נתניה",
    phone: "09-8356880",
    description: [
      "משפחת ג׳ויה הגיעה גם לנתניה ומזמינה אתכם ליהנות מחוויה איטלקית אותנטית ושמחה, בדיוק כמו בכל סניפינו במרכז ובשרון — הפעם בגרסה כשרה חלבית, על השדרה במתחם פיאנו עיר ימים.",
      "התפריט מורכב ממנות מרחבי ארץ המגף ואינו מתפשר על הטעמים המקוריים: החריפות הנעימה מסיציליה, הטרטופו של חבל טוסקנה והריזוטו המפנק של צפון איטליה ולומברדיה.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ד׳ 12:00–23:00 · ה׳ 12:00–23:30" },
      { label: "שישי", value: "אירועים פרטיים בלבד" },
      { label: "מוצ״ש", value: "שעה לאחר צאת השבת – 23:30" },
    ],
    note: "לא מקבלים שוברים",
    links: {
      menu: "https://joya.co.il/תפריט-נתניה/",
      reserve: "https://ontopo.co.il/joyairyamim/?source=homepage",
      waze: "https://waze.com/ul/hsv8z8u5c8",
      order: "https://wolt.com/en/isr/tel-aviv/restaurant/joya-netanya",
    },
    images: gallery("netanya"),
  },
  {
    slug: "or-yam",
    name: "ג׳ויה אור ים",
    city: "אור עקיבא",
    kosher: true,
    kosherText: "חלבי ודגים — כשר",
    address: "פרדס רימונים 2, אור עקיבא",
    phone: "077-9386104",
    description: [
      "משפחת ג׳ויה הגיעה גם לאור ים ומזמינה אתכם ליהנות מחוויה איטלקית אותנטית ושמחה, בגרסה כשרה חלבית.",
      "התפריט כולל מנות מאזורים שונים באיטליה — סיציליה, טוסקנה וצפון איטליה.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ה׳ 12:00–23:00" },
      { label: "מוצ״ש", value: "שעה לאחר צאת השבת – 23:00" },
    ],
    note: "לא מקבלים שוברים",
    links: {
      menu: "https://joya.co.il/תפריט-אור-ים/",
      reserve: "https://ontopo.co.il/17729981?source=homepage",
      waze: "https://www.waze.com/he/live-map/directions?to=ll.32.4839239%2C34.9166041",
    },
    images: gallery("or-yam"),
  },
  {
    slug: "rosh-pina",
    name: "ג׳ויה ראש פינה",
    city: "ראש פינה",
    kosher: true,
    kosherText: "חלבי — כשר",
    address: "דרך הגליל 12, ראש פינה",
    phone: "04-8589099",
    description: [
      "עם הכניסה למרפסת של ג׳ויה ראש פינה נוחתים לתוך מסע זיכרונות וגעגועים למחוז פוליה שבדרום איטליה — מרחבים פתוחים ושדות.",
      "המנות של השף בני אשכנזי משלימות חוויה איטלקית עם חומרי גלם איכותיים. ניתן להזמין חדר פרטי מפואר לאירועים עד 40 אורחים, לשבת במרפסת או בחלל המסעדה.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ה׳ 12:00–22:30" },
      { label: "שישי", value: "12:00 עד שעה ורבע לפני כניסת השבת" },
      { label: "שבת", value: "מחצי שעה לאחר צאת השבת – 22:45" },
    ],
    links: {
      menu: "https://joya.co.il/תפריט-ראש-פינה/",
      reserve: "https://joya.co.il/הזמן-שולחן/",
      waze: "https://waze.com/ul/hsvc78fp1y",
    },
    images: gallery("rosh-pina"),
  },
  {
    slug: "reut",
    name: "ג׳ויה רעות",
    city: "רעות",
    kosher: true,
    kosherText: "חלבי ודגים — כשר",
    address: "מרכז לב רעות, רעות",
    phone: "08-9988890",
    description: [
      "ג׳ויה הכשרה — איטלקייה כשרה ונהדרת, נגישה ונעימה, בלב מרכז לב רעות.",
      "התפריט כולל סלטים, ברוסקטות, פסטות ברטבים, דגים, פיצות וקינוחים, במטבח בניהול השף בני אשכנזי. בבקרים מוגשות ארוחות בוקר.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ד׳ 09:00–23:00 · ה׳ 09:00–23:30" },
      { label: "שישי / שבת", value: "ו׳ 09:00–15:00 · שבת 18:45–23:00" },
      { label: "ארוחות בוקר", value: "09:00–12:00" },
      { label: "עסקית צהריים", value: "א׳–ה׳ 12:00–17:00 · 15% הנחה" },
    ],
    note: "לא מקבלים שוברים",
    links: {
      menu: "https://joya.co.il/wp-content/uploads/2025/09/DOC-20250619-WA0047.pdf",
      reserve: "https://ontopo.com/he/il/page/34699806?source=google",
    },
    images: gallery("reut"),
  },
  {
    slug: "joya-de-italia",
    name: "ג׳ויה דה איטליה פ״ת",
    city: "פתח תקווה",
    kosher: true,
    kosherText: "חלבי ודגים — כשר",
    address: "תוצרת הארץ 3, עמי ב.ס.ר פתח תקווה",
    phone: "03-6989820",
    description: [
      "משפחת ג׳ויה הגיעה גם לעמי ב.ס.ר פתח תקווה ומזמינה אתכם ליהנות מחוויה איטלקית אותנטית ושמחה.",
      "התפריט מציע מנות מגוונות מאזורי איטליה ללא פשרות על הטעמים המקוריים — חריפות סיציליאנית, טרטופו טוסקני וריזוטו צפון-איטלקי.",
    ],
    hours: [
      { label: "מסעדה", value: "א׳–ה׳ 12:00–23:30" },
      { label: "שישי", value: "10:00 עד שעה לפני כניסת השבת" },
      { label: "שבת", value: "שעה לאחר צאת השבת – 24:00" },
    ],
    note: "לא מקבלים שוברים",
    links: {
      menu: "https://joya.co.il/תפריט-גויה-דה-איטליה-פת/",
      reserve: "https://ontopo.com/he/il/page/86014034?source=homepage",
      waze: "https://waze.com/ul/",
    },
    images: gallery("joya-de-italia"),
  },
];

export const BRANCH_BY_SLUG = Object.fromEntries(BRANCHES.map((b) => [b.slug, b]));
