# Lottie → AnimatedVectorDrawable

مبدل تحت وب برای تبدیل فایل‌های JSON لوتی (Lottie) به `AnimatedVectorDrawable` اندروید (فایل XML آماده‌ی `res/drawable`).

## ویژگی‌ها

- تبدیل لایه‌های Shape، Solid و Precomp، گروه‌ها، Transformها (جابه‌جایی، چرخش، مقیاس، Anchor)، Fill/Stroke، Trim Path و شکل‌های بیضی/مستطیل/ستاره
- تبدیل کی‌فریم‌ها به `objectAnimator` و easing به `pathInterpolator`؛ ویژگی‌های بدون معادل مستقیم با نمونه‌برداری به کی‌فریم‌های خطی تبدیل می‌شوند
- پیش‌نمایش هم‌زمان Lottie (با lottie-web) و AVD (با شبیه‌ساز داخلی) به‌صورت کنار هم یا روی هم (Difference)
- گزارش موارد پشتیبانی‌نشده (ماسک، Matte، متن، تصویر، گرادیان، Dash، Expression و …)
- ویرایش XML خروجی و اجرای دوباره در پیش‌نمایش، کپی و دانلود

## اجرا

پروژه یک فایل HTML مستقل است و نیازی به build ندارد:

```bash
# باز کردن مستقیم
open index.html

# یا با یک سرور محلی
python3 -m http.server 8000
```

برای پیش‌نمایش Lottie به اینترنت نیاز است (lottie-web و فونت‌ها از CDN بارگذاری می‌شوند).

> دکمه‌ی «دانلود» فعلاً فقط در محیط Claude Artifact فعال است؛ در اجرای مستقل از «کپی XML» استفاده کنید.

## استفاده در اندروید

فایل خروجی را در `res/drawable` قرار دهید. خروجی از قالب درون‌خطی `aapt:attr` استفاده می‌کند که با Android Gradle Plugin کامپایل می‌شود.

```kotlin
val avd = AnimatedVectorDrawableCompat.create(context, R.drawable.avd_animation)!!
imageView.setImageDrawable(avd)
avd.start()
```
