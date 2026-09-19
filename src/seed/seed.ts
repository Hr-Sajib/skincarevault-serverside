/* eslint-disable no-console */
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '@/lib/db';
import { Product } from '@/models/product.model';
import { Category } from '@/models/category.model';
import { Brand } from '@/models/brand.model';
import { Coupon } from '@/models/coupon.model';
import { AdminUser } from '@/models/adminUser.model';
import { Settings, DEFAULT_SHIPPING_ZONES } from '@/models/settings.model';
import { Counter } from '@/models/counter.model';
import { Review } from '@/models/review.model';
import { Order } from '@/models/order.model';
import { Customer } from '@/models/customer.model';
import { hashPassword } from '@/modules/auth/auth.service';
import { slugify } from '@/utils/text';
import { recomputeProductRating } from '@/modules/reviews/review.controller';

/**
 * Seeds a working shop: categories, brands, ~30 products with variants and
 * placeholder imagery, coupons, an owner account, and a few approved reviews.
 *
 * Destructive — it clears the collections it owns first. Guarded against
 * running against a production database.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@skincarevault.com';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026';

/** Placeholder imagery, so a fresh install has something to look at. */
const placeholder = (seed: string, label: string) => ({
  publicId: `skincarevault/seed/${seed}`,
  url: `https://picsum.photos/seed/${seed}/900/1100`,
  width: 900,
  height: 1100,
  alt: label,
  position: 0,
});

const CATEGORIES = [
  { name: 'Cleansers', description: 'Face washes, balms, and micellar waters.' },
  { name: 'Serums', description: 'Targeted actives in a lightweight base.' },
  { name: 'Moisturisers', description: 'Gels, creams, and lotions for every skin type.' },
  { name: 'Sunscreen', description: 'Daily SPF for Bangladesh sun.' },
  { name: 'Masks & Exfoliants', description: 'Weekly resets for dull or congested skin.' },
  { name: 'Lip & Eye Care', description: 'For the thinner skin that needs its own routine.' },
];

const BRANDS = [
  { name: 'The Ordinary', countryOfOrigin: 'Canada' },
  { name: 'CeraVe', countryOfOrigin: 'USA' },
  { name: 'COSRX', countryOfOrigin: 'South Korea' },
  { name: 'Beauty of Joseon', countryOfOrigin: 'South Korea' },
  { name: 'La Roche-Posay', countryOfOrigin: 'France' },
  { name: 'Simple', countryOfOrigin: 'United Kingdom' },
];

interface SeedProduct {
  title: string;
  subtitle: string;
  category: string;
  brand: string;
  concerns: string[];
  ingredients: string[];
  variants: Array<{ label: string; priceMinor: number; compareAtMinor?: number; stock: number }>;
  featured?: boolean;
}

const PRODUCTS: SeedProduct[] = [
  {
    title: 'Niacinamide 10% + Zinc 1%',
    subtitle: 'High-strength blemish and pore formula',
    category: 'Serums',
    brand: 'The Ordinary',
    concerns: ['acne', 'large-pores', 'oiliness'],
    ingredients: ['Niacinamide', 'Zinc PCA', 'Pentylene Glycol'],
    variants: [
      { label: '30 ml', priceMinor: 89000, compareAtMinor: 110000, stock: 42 },
      { label: '60 ml', priceMinor: 149000, stock: 18 },
    ],
    featured: true,
  },
  {
    title: 'Hyaluronic Acid 2% + B5',
    subtitle: 'Multi-depth hydration serum',
    category: 'Serums',
    brand: 'The Ordinary',
    concerns: ['dryness', 'dehydration'],
    ingredients: ['Sodium Hyaluronate', 'Panthenol'],
    variants: [
      { label: '30 ml', priceMinor: 95000, stock: 35 },
      { label: '60 ml', priceMinor: 160000, stock: 12 },
    ],
  },
  {
    title: 'Foaming Facial Cleanser',
    subtitle: 'For normal to oily skin, with ceramides',
    category: 'Cleansers',
    brand: 'CeraVe',
    concerns: ['oiliness', 'acne'],
    ingredients: ['Ceramide NP', 'Niacinamide', 'Hyaluronic Acid'],
    variants: [
      { label: '236 ml', priceMinor: 145000, stock: 28 },
      { label: '473 ml', priceMinor: 235000, compareAtMinor: 265000, stock: 9 },
    ],
    featured: true,
  },
  {
    title: 'Hydrating Facial Cleanser',
    subtitle: 'Non-foaming, for normal to dry skin',
    category: 'Cleansers',
    brand: 'CeraVe',
    concerns: ['dryness', 'sensitivity'],
    ingredients: ['Ceramide AP', 'Hyaluronic Acid', 'Glycerin'],
    variants: [{ label: '236 ml', priceMinor: 145000, stock: 31 }],
  },
  {
    title: 'Advanced Snail 96 Mucin Power Essence',
    subtitle: 'Repairing essence for stressed skin',
    category: 'Serums',
    brand: 'COSRX',
    concerns: ['dullness', 'scarring', 'dehydration'],
    ingredients: ['Snail Secretion Filtrate', 'Betaine', 'Panthenol'],
    variants: [{ label: '100 ml', priceMinor: 175000, compareAtMinor: 199000, stock: 24 }],
    featured: true,
  },
  {
    title: 'Low pH Good Morning Gel Cleanser',
    subtitle: 'Gentle morning cleanse at skin-friendly pH',
    category: 'Cleansers',
    brand: 'COSRX',
    concerns: ['sensitivity', 'oiliness'],
    ingredients: ['Tea Tree Oil', 'Betaine Salicylate'],
    variants: [{ label: '150 ml', priceMinor: 125000, stock: 40 }],
  },
  {
    title: 'Relief Sun: Rice + Probiotics SPF50+',
    subtitle: 'Organic daily sunscreen, no white cast',
    category: 'Sunscreen',
    brand: 'Beauty of Joseon',
    concerns: ['sun-protection', 'dullness'],
    ingredients: ['Rice Extract', 'Grain Ferment', 'Niacinamide'],
    variants: [{ label: '50 ml', priceMinor: 165000, stock: 55 }],
    featured: true,
  },
  {
    title: 'Glow Serum: Propolis + Niacinamide',
    subtitle: 'Brightening serum for uneven tone',
    category: 'Serums',
    brand: 'Beauty of Joseon',
    concerns: ['dullness', 'dark-spots'],
    ingredients: ['Propolis Extract', 'Niacinamide'],
    variants: [{ label: '30 ml', priceMinor: 155000, stock: 22 }],
  },
  {
    title: 'Anthelios UVMune 400 SPF50+',
    subtitle: 'Very high protection for sensitive skin',
    category: 'Sunscreen',
    brand: 'La Roche-Posay',
    concerns: ['sun-protection', 'sensitivity'],
    ingredients: ['Mexoryl 400', 'Thermal Spring Water'],
    variants: [{ label: '50 ml', priceMinor: 295000, compareAtMinor: 340000, stock: 14 }],
  },
  {
    title: 'Effaclar Duo+M',
    subtitle: 'Corrective unclogging care for blemishes',
    category: 'Moisturisers',
    brand: 'La Roche-Posay',
    concerns: ['acne', 'large-pores'],
    ingredients: ['Niacinamide', 'Procerad', 'Salicylic Acid'],
    variants: [{ label: '40 ml', priceMinor: 245000, stock: 16 }],
  },
  {
    title: 'Moisturising Lotion',
    subtitle: 'Lightweight daily lotion with ceramides',
    category: 'Moisturisers',
    brand: 'CeraVe',
    concerns: ['dryness'],
    ingredients: ['Ceramide NP', 'Hyaluronic Acid', 'MVE Technology'],
    variants: [
      { label: '88 ml', priceMinor: 115000, stock: 26 },
      { label: '355 ml', priceMinor: 255000, stock: 11 },
    ],
  },
  {
    title: 'AHA 30% + BHA 2% Peeling Solution',
    subtitle: 'Ten-minute weekly exfoliating mask',
    category: 'Masks & Exfoliants',
    brand: 'The Ordinary',
    concerns: ['dullness', 'texture', 'large-pores'],
    ingredients: ['Glycolic Acid', 'Salicylic Acid', 'Tasmanian Pepperberry'],
    variants: [{ label: '30 ml', priceMinor: 105000, stock: 33 }],
    featured: true,
  },
  {
    title: 'Kind to Skin Micellar Water',
    subtitle: 'No-rinse cleansing water for all skin types',
    category: 'Cleansers',
    brand: 'Simple',
    concerns: ['sensitivity'],
    ingredients: ['Triple Purified Water', 'Panthenol', 'Vitamin B3'],
    variants: [
      { label: '200 ml', priceMinor: 65000, stock: 48 },
      { label: '400 ml', priceMinor: 105000, stock: 20 },
    ],
  },
  {
    title: 'Acne Pimple Master Patch',
    subtitle: 'Hydrocolloid patches in three sizes',
    category: 'Masks & Exfoliants',
    brand: 'COSRX',
    concerns: ['acne'],
    ingredients: ['Hydrocolloid', 'Cellulose Gum'],
    variants: [{ label: '24 patches', priceMinor: 45000, stock: 80 }],
  },
  {
    title: 'Revive Eye Serum: Ginseng + Retinal',
    subtitle: 'Firming eye serum for fine lines',
    category: 'Lip & Eye Care',
    brand: 'Beauty of Joseon',
    concerns: ['fine-lines', 'dark-circles'],
    ingredients: ['Ginseng Root Water', 'Retinal', 'Niacinamide'],
    variants: [{ label: '30 ml', priceMinor: 185000, stock: 13 }],
  },
  {
    title: 'Matte Sun Stick: Mugwort + Camelia',
    subtitle: 'Portable SPF50+ stick for touch-ups',
    category: 'Sunscreen',
    brand: 'Beauty of Joseon',
    concerns: ['sun-protection', 'oiliness'],
    ingredients: ['Mugwort Extract', 'Camellia Leaf'],
    variants: [{ label: '18 g', priceMinor: 135000, stock: 29 }],
  },
  {
    title: 'Salicylic Acid 2% Solution',
    subtitle: 'Daily BHA for congested skin',
    category: 'Serums',
    brand: 'The Ordinary',
    concerns: ['acne', 'large-pores', 'texture'],
    ingredients: ['Salicylic Acid', 'Witch Hazel'],
    variants: [{ label: '30 ml', priceMinor: 85000, stock: 37 }],
  },
  {
    title: 'Vitamin C Suspension 23% + HA',
    subtitle: 'High-strength brightening treatment',
    category: 'Serums',
    brand: 'The Ordinary',
    concerns: ['dark-spots', 'dullness'],
    ingredients: ['L-Ascorbic Acid', 'Sodium Hyaluronate'],
    variants: [{ label: '30 ml', priceMinor: 92000, stock: 0 }],
  },
  {
    title: 'Ultra-Light Daily UV Fluid SPF50+',
    subtitle: 'Invisible fluid that layers under makeup',
    category: 'Sunscreen',
    brand: 'La Roche-Posay',
    concerns: ['sun-protection'],
    ingredients: ['Mexoryl XL', 'Thermal Spring Water'],
    variants: [{ label: '50 ml', priceMinor: 275000, stock: 17 }],
  },
  {
    title: 'Aloe Soothing Sun Cream SPF50+',
    subtitle: 'Cooling daily sunscreen with aloe',
    category: 'Sunscreen',
    brand: 'COSRX',
    concerns: ['sun-protection', 'sensitivity'],
    ingredients: ['Aloe Barbadensis Leaf', 'Panthenol'],
    variants: [{ label: '50 ml', priceMinor: 125000, stock: 34 }],
  },
  {
    title: 'Hydrating Cleansing Balm',
    subtitle: 'First-step balm that melts sunscreen',
    category: 'Cleansers',
    brand: 'Beauty of Joseon',
    concerns: ['dryness'],
    ingredients: ['Rice Bran Oil', 'Sunflower Seed Oil'],
    variants: [{ label: '100 ml', priceMinor: 145000, stock: 21 }],
  },
  {
    title: 'Oil-Free Ultra-Moisturising Lotion',
    subtitle: 'Hydration without the heaviness',
    category: 'Moisturisers',
    brand: 'CeraVe',
    concerns: ['oiliness', 'dehydration'],
    ingredients: ['Ceramide NP', 'Hyaluronic Acid', 'Squalane'],
    variants: [{ label: '52 ml', priceMinor: 135000, stock: 25 }],
  },
  {
    title: 'Snail Mucin Power Repair Cream',
    subtitle: 'Rich repairing night cream',
    category: 'Moisturisers',
    brand: 'COSRX',
    concerns: ['dryness', 'scarring'],
    ingredients: ['Snail Secretion Filtrate', 'Shea Butter'],
    variants: [{ label: '100 g', priceMinor: 185000, stock: 15 }],
  },
  {
    title: 'Natural Moisturising Factors + HA',
    subtitle: 'Surface hydration for everyday use',
    category: 'Moisturisers',
    brand: 'The Ordinary',
    concerns: ['dryness'],
    ingredients: ['Amino Acids', 'Hyaluronic Acid', 'Ceramides'],
    variants: [
      { label: '30 ml', priceMinor: 68000, stock: 44 },
      { label: '100 ml', priceMinor: 125000, stock: 19 },
    ],
  },
  {
    title: 'Ginseng Essence Water',
    subtitle: 'Hydrating first essence with ginseng',
    category: 'Serums',
    brand: 'Beauty of Joseon',
    concerns: ['dullness', 'fine-lines'],
    ingredients: ['Ginseng Root Water', 'Niacinamide'],
    variants: [{ label: '150 ml', priceMinor: 165000, stock: 18 }],
  },
  {
    title: 'Ultra-Light Moisturising Gel',
    subtitle: 'Water-gel finish for humid days',
    category: 'Moisturisers',
    brand: 'Simple',
    concerns: ['oiliness', 'dehydration'],
    ingredients: ['Vitamin B5', 'Vitamin E', 'Glycerin'],
    variants: [{ label: '125 ml', priceMinor: 78000, stock: 36 }],
  },
  {
    title: 'Clarifying Treatment Toner',
    subtitle: 'Daily BHA toner for clearer skin',
    category: 'Masks & Exfoliants',
    brand: 'COSRX',
    concerns: ['acne', 'texture'],
    ingredients: ['Betaine Salicylate', 'Willow Bark Water'],
    variants: [{ label: '150 ml', priceMinor: 135000, stock: 23 }],
  },
  {
    title: 'Apricot Kernel Lip Balm',
    subtitle: 'Overnight repair for chapped lips',
    category: 'Lip & Eye Care',
    brand: 'Simple',
    concerns: ['dryness'],
    ingredients: ['Apricot Kernel Oil', 'Shea Butter', 'Vitamin E'],
    variants: [{ label: '10 g', priceMinor: 38000, stock: 62 }],
  },
  {
    title: 'Caffeine Solution 5% + EGCG',
    subtitle: 'For eye contours and dark circles',
    category: 'Lip & Eye Care',
    brand: 'The Ordinary',
    concerns: ['dark-circles', 'puffiness'],
    ingredients: ['Caffeine', 'Epigallocatechin Gallatyl Glucoside'],
    variants: [{ label: '30 ml', priceMinor: 82000, stock: 27 }],
  },
  {
    title: 'Toleriane Dermo-Cleanser',
    subtitle: 'No-rinse cleanser for reactive skin',
    category: 'Cleansers',
    brand: 'La Roche-Posay',
    concerns: ['sensitivity', 'dryness'],
    ingredients: ['Glycerin', 'Thermal Spring Water'],
    variants: [{ label: '200 ml', priceMinor: 215000, stock: 12 }],
  },
];

const REVIEW_SAMPLES = [
  { rating: 5, title: 'Worth every taka', body: 'Three weeks in and my skin is noticeably calmer. Packaging arrived sealed and the expiry is far out.' },
  { rating: 4, title: 'Good, but slow', body: 'Works well, just needs patience. I have been using it nightly for a month and the marks are fading.' },
  { rating: 5, title: 'Repurchasing', body: 'Second bottle already. Absorbs fast and sits fine under sunscreen in Dhaka humidity.' },
  { rating: 4, title: 'Solid daily option', body: 'No irritation at all, which is rare for me. Delivery to Chattogram took three days.' },
  { rating: 5, title: 'Genuine product', body: 'Batch code checked out. Texture and smell match what I bought abroad last year.' },
];

async function seed(): Promise<void> {
  await connectDB();

  const dbName = mongoose.connection.name;
  if (/prod/i.test(dbName) && process.env.SEED_FORCE !== 'true') {
    throw new Error(
      `Refusing to seed "${dbName}" — the name looks like production. Set SEED_FORCE=true to override.`,
    );
  }

  console.log(`\nSeeding "${dbName}"...\n`);

  await Promise.all([
    Product.deleteMany({}),
    Category.deleteMany({}),
    Brand.deleteMany({}),
    Coupon.deleteMany({}),
    Review.deleteMany({}),
    Order.deleteMany({}),
    Customer.deleteMany({}),
    AdminUser.deleteMany({}),
    Counter.deleteMany({}),
    Settings.deleteMany({}),
  ]);
  console.log('  cleared existing data');

  const categories = await Category.insertMany(
    CATEGORIES.map((c, i) => ({ ...c, slug: slugify(c.name), position: i, isActive: true })),
  );
  const categoryByName = new Map(categories.map((c) => [c.name, c._id]));
  console.log(`  ${categories.length} categories`);

  const brands = await Brand.insertMany(
    BRANDS.map((b) => ({ ...b, slug: slugify(b.name), isActive: true })),
  );
  const brandByName = new Map(brands.map((b) => [b.name, b._id]));
  console.log(`  ${brands.length} brands`);

  const products = await Product.insertMany(
    PRODUCTS.map((p) => {
      const slug = slugify(p.title);
      return {
        slug,
        title: p.title,
        subtitle: p.subtitle,
        description:
          `<p>${p.subtitle}. Formulated with ${p.ingredients.slice(0, 2).join(' and ')}, ` +
          `and suited to ${p.concerns.join(', ').replace(/-/g, ' ')}.</p>` +
          '<h3>How to use</h3><p>Apply to clean, dry skin. Follow with moisturiser and, in the morning, sunscreen.</p>',
        brandId: brandByName.get(p.brand) ?? null,
        categoryIds: [categoryByName.get(p.category)].filter(Boolean),
        ingredients: p.ingredients,
        skinConcerns: p.concerns,
        images: [
          placeholder(slug, `${p.title} bottle`),
          { ...placeholder(`${slug}-2`, `${p.title} texture`), position: 1 },
        ],
        variants: p.variants.map((v, i) => ({
          sku: `${slugify(p.brand).slice(0, 3).toUpperCase()}-${slug.slice(0, 8).toUpperCase()}-${i + 1}`,
          label: v.label,
          priceMinor: v.priceMinor,
          compareAtMinor: v.compareAtMinor ?? null,
          stock: v.stock,
          reserved: 0,
          isDefault: i === 0,
        })),
        status: 'published',
        isFeatured: p.featured ?? false,
        // No " | Skincare Vault" suffix here — the storefront's metadata
        // template appends the store name already, and baking it in too
        // produces "Title | Skincare Vault | Skincare Vault".
        seo: { title: p.title, description: p.subtitle },
      };
    }),
  );
  console.log(`  ${products.length} products`);

  // A handful of approved reviews, so ratings are not all zero on a fresh install.
  const reviewDocs = products.slice(0, 12).flatMap((product, i) =>
    REVIEW_SAMPLES.slice(0, (i % 3) + 1).map((sample, j) => ({
      productId: product._id,
      customerName: ['Nusrat A.', 'Tanvir H.', 'Sadia R.', 'Imran K.', 'Farhana M.'][(i + j) % 5],
      rating: sample.rating,
      title: sample.title,
      body: sample.body,
      status: 'approved' as const,
    })),
  );
  await Review.insertMany(reviewDocs);
  for (const product of products.slice(0, 12)) {
    await recomputeProductRating(product._id.toString());
  }
  console.log(`  ${reviewDocs.length} reviews`);

  const now = new Date();
  const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await Coupon.insertMany([
    {
      code: 'WELCOME10',
      description: '10% off a first order',
      type: 'percent',
      value: 10,
      minSpendMinor: 100000,
      maxDiscountMinor: 50000,
      expiresAt: inThirtyDays,
      perCustomerLimit: 1,
      isActive: true,
    },
    {
      code: 'FLAT100',
      description: 'Flat BDT 100 off orders over BDT 1500',
      type: 'fixed',
      value: 10000,
      minSpendMinor: 150000,
      usageLimit: 200,
      expiresAt: inThirtyDays,
      isActive: true,
    },
    {
      code: 'SERUM15',
      description: '15% off serums',
      type: 'percent',
      value: 15,
      minSpendMinor: 0,
      appliesTo: {
        scope: 'categories',
        categoryIds: [categoryByName.get('Serums')].filter(Boolean),
        productIds: [],
      },
      expiresAt: inThirtyDays,
      isActive: true,
    },
  ]);
  console.log('  3 coupons');

  await Settings.create({
    _id: 'store',
    store: {
      name: 'Skincare Vault',
      tagline: 'Authentic skincare, delivered across Bangladesh.',
      email: 'hello@skincarevault.com',
      phone: '+8801700000000',
      address: 'Gulshan 1, Dhaka 1212',
    },
    shippingZones: DEFAULT_SHIPPING_ZONES,
    payment: { codEnabled: true, sslcommerzEnabled: true, minOrderMinor: 30000 },
    inventory: { lowStockThreshold: 5, urgencyThreshold: 5 },
    orderPrefix: 'SV',
  });
  console.log('  store settings');

  await AdminUser.create({
    name: 'Store Owner',
    email: ADMIN_EMAIL,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: 'owner',
    isActive: true,
  });

  console.log('\nDone.\n');
  console.log(`  Admin sign-in:  ${ADMIN_EMAIL}`);
  console.log(`  Password:       ${ADMIN_PASSWORD}`);
  console.log('\n  Change that password before going anywhere near production.\n');

  await disconnectDB();
}

seed().catch(async (err) => {
  console.error('\nSeed failed:', err);
  await disconnectDB().catch(() => undefined);
  process.exit(1);
});
