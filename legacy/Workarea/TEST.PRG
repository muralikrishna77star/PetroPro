indate={01/01/2018}

select icode, sgst_per, cgst_per, igst_per, ;
sum(amt), sum(sgst_amt) as sgst_amt, ;
sum(cgst_amt) as cgst_amt, sum(igst_amt) as igst_amt ;
from temprep ;
group by icode,sgst_per, cgst_per, igst_per ;
 having bill_date=indate

Text  
select temprep.icode, sgst_per, cgst_per, igst_per, sum(temprep.amt),;
  sum(sgst_amt) sum_sgst, sum(cgst_amt) sum_csgst, sum(igst_amt) sum_igst;	
  from temprep;
  group by temprep.icode, sgst_per, cgst_per, igst_per;
  having temprep.bill_date=indate;
  into table rep2.dbf
EndText