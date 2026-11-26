# Synthetic GC pay app (G702 Payment + G703 Continuation Sheet) laid out like Ken's Dalling Hangar Pay App 01. No real names, addresses or phones.
import sys, zipfile, re, datetime, shutil
from openpyxl import Workbook
out = sys.argv[1]
wb = Workbook()
pay = wb.active; pay.title = 'Payment'
pay['A1'] = 'APPLICATION AND CERTIFICATE FOR PAYMENT'
pay['A3'] = 'TO OWNER/CLIENT: Sample General Contractor'; pay['A5'] = 'FROM CONTRACTOR: Sample Drywall Sub'
pay['M2'] = 'APPLICATION NO:'; pay['N2'] = 1
pay['M3'] = 'PERIOD FROM:'; pay['N3'] = datetime.datetime(2026, 11, 1)
pay['M4'] = 'FOR WORK THROUGH:'; pay['N4'] = datetime.datetime(2026, 11, 30)
pay['N3'].number_format = pay['N4'].number_format = 'mm/dd/yyyy'
pay['A19'] = '1. ORIGINAL CONTRACT SUM'; pay['F19'] = 100637
pay['A20'] = '2. NET CHANGE BY CHANGE ORDERS'; pay['F20'] = 0
pay['A21'] = '3. CONTRACT SUM TO DATE (Line 1 ± 2)'; pay['F21'] = 100637
pay['A22'] = '4. TOTAL COMPLETED & STORED TO DATE'; pay['F22'] = 13639
cs = wb.create_sheet('Continuation Sheet')
cs['A1'] = 'CONTINUATION SHEET'; cs['H2'] = 'APPLICATION NO:'; cs['I2'] = 1
cs['A4'] = 'PROJECT: Sample Hangar'
heads = ['LINE ITEM', 'DESCRIPTION OF WORK', 'SCHEDULED VALUE', 'FROM PREVIOUS APPLICATION', 'THIS PERIOD', 'MATERIALS PRESENTLY STORED', 'TOTAL COMPLETED AND STORED TO DATE', '% (G/C)', 'BALANCE TO FINISH', 'RETAINAGE']
cs['D8'] = 'WORK COMPLETED'
for i, h in enumerate(heads): cs.cell(row=9, column=i + 1, value=h)
lines = [('Mobilization', 2013, 2013), ('Framing Labor', 14781, 1000), ('Framing Material', 17252, 8626), ('Hanging Labor', 20958, 0),
         ('Hanging Material', 15667, 0), ('Finishing Labor', 11859, 0), ('Finishing Material', 2724, 0), ('Insulation Labor', 1970, 0),
         ('Insulation Material', 7397, 0), ('Misc / Cleanup Labor', 6016, 2000)]
for k, (d, v, g) in enumerate(lines):
    r = 10 + k
    cs.cell(row=r, column=1, value=k + 1); cs.cell(row=r, column=2, value=d); cs.cell(row=r, column=3, value=v)
    cs.cell(row=r, column=4, value=0); cs.cell(row=r, column=5, value=g); cs.cell(row=r, column=6, value=0); cs.cell(row=r, column=7, value=g)
    cs.cell(row=r, column=8, value=round(g / v, 4)); cs.cell(row=r, column=9, value=v - g); cs.cell(row=r, column=10, value=round(g * .05, 2))
cs['B20'] = 'ORIGINAL CONTRACT TOTALS'; cs['C20'] = 100637; cs['G20'] = 13639
for k in range(6):
    r = 21 + k; cs.cell(row=r, column=2, value='CO # %d' % (k + 1)); cs.cell(row=r, column=3, value=0); cs.cell(row=r, column=7, value=0)
cs['B27'] = 'CO # 7'; cs['C27'] = 0
cs['B28'] = 'CHANGE ORDER TOTALS'; cs['C28'] = 0
cs['B29'] = 'REVISED CONTRACT TOTALS'; cs['C29'] = 100637
tmp = out + '.tmp'
wb.save(tmp)
# put formulas in front of the cached values, like a real workbook (the app must read the cached <v>, not run the formula)
F = {'xl/worksheets/sheet2.xml': {'C20': 'SUM(C10:C19)', 'G20': 'SUM(G10:G19)', 'C29': 'C20+C28', **{'G%d' % r: 'D%d+E%d+F%d' % (r, r, r) for r in range(10, 20)}},
     'xl/worksheets/sheet1.xml': {'F21': 'F19+F20', 'F22': "'Continuation Sheet'!G20"}}
zin = zipfile.ZipFile(tmp); zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for it in zin.infolist():
    data = zin.read(it.filename)
    if it.filename in F:
        x = data.decode()
        for ref, f in F[it.filename].items():
            x, n = re.subn(r'(<c r="%s"[^>]*>)(<v>)' % ref, lambda m: m.group(1) + '<f>' + f.replace('&', '&amp;').replace("'", '&apos;') + '</f>' + m.group(2), x)
            assert n == 1, ref
        data = x.encode()
    zout.writestr(it, data)
zout.close(); zin.close()
import os; os.remove(tmp)
print('wrote', out)
