set safe off
set defaul to C:\petbill\workarea
=ADDFLD("CUSTOMER","TINNO",'C',15)
=ADDFLD("ITEM","TAX_PER",'N',8,2)
=ADDFLD("ITEM","IPRICEWBTX",'N',8,2)
=ADDFLD("ITEM","IPRICEWTAX",'N',8,2)
=ADDFLD("ITEM","IPRICERBTX",'N',8,2)
=ADDFLD("ITEM","IPRICERTAX",'N',8,2)
=ADDFLD("ITEM","PUR_VALBTX",'N',8,2)
=ADDFLD("ITEM","PUR_VALTAX",'N',8,2)


=ADDFLD("BILLTEMP","Ratebtx",'N',8,2)
=ADDFLD("BILLTEMP","Tax_per",'N',8,2)
=ADDFLD("BILLTEMP","UTax_Amt",'N',8,2)
=ADDFLD("BILLTEMP","Tax_Amt",'N',8,2)

=ADDFLD("BILL","Ratebtx",'N',8,2)
=ADDFLD("BILL","Tax_per",'N',8,2)
=ADDFLD("BILL","UTax_Amt",'N',8,2)
=ADDFLD("BILL","Tax_Amt",'N',8,2)


=ADDFLD("JanBil07","Ratebtx",'N',8,2)
=ADDFLD("JanBil07","Tax_per",'N',8,2)
=ADDFLD("JanBil07","UTax_Amt",'N',8,2)
=ADDFLD("JanBil07","Tax_Amt",'N',8,2)
