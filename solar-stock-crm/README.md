# Stock Summary & CRM (Vercel)
1. Upload this folder to a GitHub repo -> Vercel -> Add New Project -> Import (Framework: Other).
2. Vercel project -> Storage / Marketplace -> add "Upstash Redis" (free) and connect it to the project.
3. Settings -> Environment Variables: STOCKIST_PASSWORD, ADMIN_PASSWORD, SECRET (see .env.example).
4. Redeploy. Login: select Stockist or Admin and enter the password.
Shop name, address and mobile for receipts/slips are SHOP, SHOP_ADDR, SHOP_PHONE at the top of public/index.html.

## If login does not work
- Message "... is not set on the server": add the password in Vercel -> Settings -> Environment Variables, then click Redeploy (new variables only apply to a new deployment).
- Message "Server error ... /api folder is not deployed": the project Root Directory must be the folder that contains `api` and `public` (Vercel -> Settings -> General -> Root Directory).
- Login names: choose Stockist or Admin in the box and type the matching password.

## Agreement (Word)
Admin -> Customers (CRM) -> "Agreement" button on a customer. Fill/confirm name, consumer number, address, district, date, total cost, system size and inverter size, then download the .docx.
The model agreement is `public/agreement-template.docx`. Fields in it look like {{NAME}}, {{AMOUNT}}. Vendor details and all terms are fixed text; edit them in Word if they change (keep the {{...}} fields).

## Delivery orders
Admin -> Delivery Orders -> choose customer, site and items -> "Send to stockist". The stockist sees it (with a "new" count), marks the material ready, then uses "Make stock out" when the bill is made. The order becomes Delivered automatically.

## WCL (Work Completion Report)
Admin -> Customers (CRM) -> "WCL" button. Fill the details (optional Aadhaar number/photo), preview, then download Word or PDF. Template: `public/wcl-template.docx` (fields look like {{NAME}}).

## Aadhaar card reader (WCL)
In the WCL form, choose the Aadhaar card photo: the name and 12-digit number are read automatically and filled in (check them before continuing). It runs inside the browser using the files in `public/ocr` (the photo is not uploaded anywhere). The first read can take a little longer while the reader loads.

## WCL layout
The WCL PDF is drawn at the exact positions of the reference WCL file (table 66.7 to 547.9 pt wide, stamps and signature lines in the same places). Download PDF gives exactly what the preview shows; Download Word uses `public/wcl-template.docx` with the same table position. The PDF supports English letters only (use Word for Marathi text).
