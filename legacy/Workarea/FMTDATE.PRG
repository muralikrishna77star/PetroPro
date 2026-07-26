parameter indate, fmt
if fmt="dd/mm/yy"
 return padl(alltrim(str(day(indate))),2,'0')+"/"+padl(alltrim(str(month(indate))),2,'0')+"/"+right(alltrim(str(year(indate))),2)
else
	return indate
endif 
