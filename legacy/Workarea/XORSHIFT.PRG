function XORSHIFT
parameter str1, xshift
strres=""
strbin=""
pos=1
strlen=len(alltrim(str1))
do while pos<=strlen
	strres=strres+chr(ascofbin(shift(XOR(binary(substr(str1,pos,1))),3)))
	*wait window alltrim(str(pos))+"-"+substr(str1,pos,1)+"-"+binary(substr(str1,pos,1))
	pos=pos+1
enddo	
return strres
