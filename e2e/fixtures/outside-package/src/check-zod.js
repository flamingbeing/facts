import { z } from 'zod';
import { show } from './show.js';

const Item = z.object({ title: z.string().min(1), qty: z.number().int() });
const good = Item.safeParse({ title: 'milk', qty: 2 });
const bad = Item.safeParse({ title: '', qty: 1.5 });
show(good.success && !bad.success ? `zod ok: ${bad.error.issues.length} issues` : 'zod failed');
