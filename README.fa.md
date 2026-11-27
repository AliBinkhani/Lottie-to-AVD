<div dir="rtl">

# Lottie → AnimatedVectorDrawable

[English](README.md) | **فارسی**

مبدلی تحت وب که انیمیشن‌های JSON لوتی ([Lottie](https://airbnb.io/lottie/)) را به فایل XML از نوع
[`AnimatedVectorDrawable`](https://developer.android.com/reference/android/graphics/drawable/AnimatedVectorDrawable)
اندروید تبدیل می‌کند. خروجی آماده‌ی قرار گرفتن در پوشه‌ی `res/drawable` است.

همه‌چیز به‌صورت محلی در مرورگر اجرا می‌شود و هیچ فایلی جایی آپلود نمی‌شود.

## ویژگی‌ها

- **تبدیل**: لایه‌های Shape، Solid و Precomp، والد‌گذاری لایه‌ها، گروه‌ها، Transformها (جابه‌جایی، چرخش، مقیاس و Anchor Point)، Fill و Stroke، گرادیان‌های خطی و شعاعی، Trim Path، شکل‌های بیضی، مستطیل و ستاره، و Track Matte و ماسک (به‌صورت `<clip-path>`).
- **زمان‌بندی دقیق**: کی‌فریم‌ها به `objectAnimator` و منحنی‌های easing لوتی به `pathInterpolator` تبدیل می‌شوند. ویژگی‌هایی که معادل مستقیم در AVD ندارند با نمونه‌برداری به کی‌فریم‌های خطی تبدیل می‌شوند و خروجی همچنان کاملاً برداری می‌ماند.
- **خروجی فشرده**: هر جا ممکن باشد انیماتور دقیق ساخته می‌شود (مسیرهای حرکت صاف، تغییرهای پله‌ای مثل نقطه‌ی ورود و خروج لایه)، گروه‌های والد بین لایه‌ها مشترک‌اند، هر لایه فقط یک انیماتور نمایش/پنهان دارد و ویژگی‌های نمونه‌برداری‌شده با دقتی کمتر از یک پیکسل ساده می‌شوند.
- **مقایسه‌ی زنده**: لوتی اصلی (با lottie-web) و AVD تولیدشده (با شبیه‌ساز داخلی) کنار هم یا روی هم با حالت ترکیب Difference پخش می‌شوند.
- **گزارش تبدیل**: موارد پشتیبانی‌نشده مثل ماسک، Matte، متن، تصویر، گرادیان، خط‌چین و Expression را فهرست می‌کند.
- **خروجی قابل ویرایش**: XML را ویرایش کنید، دوباره در پیش‌نمایش اجرا کنید و بعد کپی یا دانلود کنید.
- **رابط دوزبانه**: انگلیسی (پیش‌فرض) و فارسی با پشتیبانی کامل از راست‌به‌چپ. زبان انتخاب‌شده به خاطر سپرده می‌شود و با `?lang=fa` یا `?lang=en` در آدرس هم می‌شود آن را تعیین کرد.
- **کارکرد آفلاین**: lottie-web و فونت‌ها داخل پروژه هستند و به هیچ CDNی وابستگی وجود ندارد.

## راه‌اندازی

پروژه فقط HTML، CSS و ES Module است و مرحله‌ی build ندارد. مرورگرها ES Moduleها را از آدرس `file://` بارگذاری نمی‌کنند، پس پوشه را با یک وب‌سرور ساده اجرا کنید:

<div dir="ltr">

```bash
# Python
python3 -m http.server 8000

# یا Node.js (بدون نیاز به نصب)
node tests/server.mjs 8000
```

</div>

سپس <http://localhost:8000> را باز کنید.

سایت را می‌توانید بدون تغییر روی هر میزبان استاتیکی مثل GitHub Pages، Netlify یا Cloudflare Pages منتشر کنید.

## استفاده از خروجی در اندروید

1. فایل XML را با نام `res/drawable/<name>.xml` ذخیره کنید.
2. این فایل از قالب درون‌خطی `aapt:attr` استفاده می‌کند که با Android Gradle Plugin کامپایل می‌شود.
3. AVD به‌صورت پیش‌فرض تکرار نمی‌شود. برای پخش پیوسته:

<div dir="ltr">

```kotlin
val avd = AnimatedVectorDrawableCompat.create(context, R.drawable.avd_animation)!!
imageView.setImageDrawable(avd)
avd.registerAnimationCallback(object : Animatable2Compat.AnimationCallback() {
    override fun onAnimationEnd(drawable: Drawable?) {
        imageView.post { avd.start() }   // تکرار پیوسته
    }
})
avd.start()
```

</div>

### گرادیان و حداقل SDK

گرادیان‌ها به‌صورت عنصر درون‌خطی `<gradient>` داخل `fillColor` یا `strokeColor` نوشته می‌شوند و به اندروید ۷ (API 24) یا بالاتر، یا `AnimatedVectorDrawableCompat` نیاز دارند. گزینه‌ی **پشتیبانی از گرادیان (نیازمند API 24 به بالا)** به‌صورت پیش‌فرض روشن است. اگر برای نسخه‌های قدیمی‌تر از drawable خود پلتفرم استفاده می‌کنید آن را خاموش کنید تا هر گرادیان با اولین رنگش جایگزین شود.

## محدودیت‌ها

ویژگی‌های زیر در AVD معادلی ندارند. نادیده گرفته یا تقریب زده می‌شوند و هر کدام که در فایل باشد در گزارش تبدیل می‌آید:

| ویژگی | رفتار |
| --- | --- |
| Luma Matte | به‌صورت Alpha Matte تبدیل می‌شود |
| مت و ماسک نرم (شفافیت جزئی، گرادیان، Feather، Expansion) | با لبه‌ی تیز برش می‌خورد |
| Track Matte ساخته‌شده از خط (Stroke) | به چندضلعی دورخط تبدیل می‌شود؛ اتصال‌های گرد و Bevel تقریبی‌اند |
| حالت‌های ماسک به‌جز Add و پس از آن Subtract یا Intersect (مثلاً Add بعد از Subtract، Lighten، Difference) | تقریبی تبدیل می‌شود |
| لایه‌های متن و تصویر | حذف می‌شوند (متن را در After Effects به Shape تبدیل کنید) |
| گرادیان متحرک | با فریم اولش تبدیل می‌شود (AVD گرادیان را انیمیت نمی‌کند) |
| Highlight گرادیان شعاعی | نادیده گرفته می‌شود و گرادیان از مرکز رسم می‌شود |
| گرادیان وقتی گزینه‌ی *پشتیبانی از گرادیان* خاموش است | با اولین رنگ آن جایگزین می‌شود |
| خط‌چین (Dash) | به‌صورت خط پیوسته رسم می‌شود |
| Merge Paths، Repeater، Round Corners، Twist، Pucker/Bloat، Zig Zag، Offset Path | نادیده گرفته می‌شوند |
| لایه‌های سه‌بعدی، Skew، Time Remap، افکت‌های لایه | نادیده گرفته می‌شوند |
| Expressionها | فقط کی‌فریم‌های ثابت استفاده می‌شوند |
| تغییر شکل با تعداد رأس متفاوت | تغییر شکل حذف می‌شود |
| فایل‌های فشرده‌ی `.lottie` | هنوز پشتیبانی نمی‌شوند؛ از فایل JSON استفاده کنید |

## ساختار پروژه

<div dir="ltr">

```
.
├── index.html                  # Page markup (text comes from i18n keys)
├── samples/
│   ├── sample.json             # Demo: basic shapes, morph, trim path
│   ├── gradient.json           # Demo: linear/radial gradient fills and strokes
│   └── mattes.json             # Demo: alpha / inverted mattes and masks
├── src/
│   ├── css/
│   │   ├── fonts.css           # Self-hosted @font-face rules
│   │   └── styles.css          # Theme tokens (light/dark) and layout
│   └── js/
│       ├── core/               # math.js, format.js
│       ├── lottie/             # properties.js, geometry.js, gradient.js, transform.js
│       ├── converter/          # tracks.js, clipping.js, converter.js, xml-writer.js
│       ├── player/             # avd-player.js
│       ├── i18n/               # i18n.js, locales/en.js, locales/fa.js
│       └── ui/                 # app.js, download.js
├── assets/fonts/               # Vazirmatn, JetBrains Mono (+ OFL licences)
├── vendor/lottie-web/          # lottie-web 5.12.2 light player (+ MIT licence)
└── tests/                      # run.mjs, server.mjs, cases.json, golden/, fixtures/
```

</div>

برای توضیح کامل هر فایل، [README انگلیسی](README.md#project-structure) را ببینید.

### افزودن زبان جدید

1. فایل `src/js/i18n/locales/en.js` را کپی کنید (مثلاً با نام `de.js`) و مقادیرش را ترجمه کنید.
2. آن را با جهت متن و locale اعداد در `LOCALES` داخل `src/js/i18n/i18n.js` ثبت کنید.
3. اگر بیش از دو زبان دارید، دکمه‌ی تغییر زبان در `src/js/ui/app.js` را هم به‌روز کنید.

## تست‌ها

تست‌های پسرفت هر نمونه و هر فایل تست را در Chromium بدون پنجره تبدیل می‌کنند و این‌ها را بررسی می‌کنند:

1. **تطابق بصری**: نمای تفاوت خود برنامه (لوتی در برابر پیش‌نمایش AVD) در چند فریم. میانگین روشنایی پیکسل‌ها باید از `maxDiff` آن مورد کمتر باشد (صفر یعنی یکسان؛ لبه‌های anti-aliasing به‌تنهایی حدود ۱.۵ می‌دهند).
2. **حجم**: تعداد `objectAnimator`ها باید از `maxAnimators` کمتر باشد.
3. **هشدارها**: گزارش تبدیل باید با فهرست مورد انتظار یکی باشد.
4. **خروجی**: XML باید با فایل مرجع در `tests/golden/` یکی باشد.

<div dir="ltr">

```bash
npm install
npx playwright install chromium   # first time only
npm test                          # all cases
npm test -- holes                 # cases whose name contains "holes"
npm run test:update               # rewrite golden XML after an intended output change
```

</div>

وقتی بررسی‌ای شکست بخورد، تصاویر تفاوت و XML واقعی در `tests/output/` ذخیره می‌شوند. تست‌ها روی هر Pull Request خودکار با GitHub Actions اجرا می‌شوند و در صورت شکست، همین فایل‌ها با نام `test-output` به اجرا پیوست می‌شوند.

بررسی بصری با شبیه‌ساز AVD داخل مرورگر مقایسه می‌کند، نه با دستگاه اندروید واقعی؛ پس برای تغییرهای بزرگ‌تر تست روی دستگاه همچنان لازم است.

برای افزودن یک مورد جدید، فایل لوتی را در `samples/` یا `tests/fixtures/` بگذارید، یک ورودی به `tests/cases.json` اضافه کنید، `npm run test:update` را اجرا کنید و فایل مرجع جدید را بررسی کنید.

## اجزای شخص ثالث

- [lottie-web](https://github.com/airbnb/lottie-web) نسخه‌ی 5.12.2، مجوز MIT (`vendor/lottie-web/LICENSE.md`)
- فونت [Vazirmatn](https://github.com/rastikerdar/vazirmatn)، مجوز SIL Open Font License 1.1
- فونت [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono)، مجوز SIL Open Font License 1.1

</div>
