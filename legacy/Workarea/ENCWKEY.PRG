FUNCTION ENCWKEY
PARAMETER STR, STRKEY, MIXSEQ, BITSHIFT
strenc=""
strxor=""

strenc=MIXSTR(STR, STRKEY, MIXSEQ)
*?strenc
strXOR=XORSHIFT(strenc,BITSHIFT)
return strXOR


function XORSHIFT
parameter str1, xshift
strres=""
strbin=""
pos=1
strlen=len(alltrim(str1))
do while pos<=strlen
	strres=strres+chr(ascofbin(shift(XOR(binary(substr(str1,pos,1))),xshift)))
	*wait window alltrim(str(pos))+"-"+substr(str1,pos,1)+"-"+binary(substr(str1,pos,1))
	pos=pos+1
enddo	
return strres


function binary
parameter charinp
ascofchar=asc(charinp)
rem=ascofchar
strbin=""
do while rem>=2
	strbin=alltrim(strbin)+alltrim(str(Mod(rem,2)))
	rem=floor(rem/2)
	if rem=1
		strbin=strbin+"1"
	endif
enddo
return padr(strbin,8,"0")

function shift
parameter strbin, bits
strbin=padr(alltrim(strbin),8,"0")
strres=substr(strbin,9-bits,bits)
strres=strres+substr(strbin,1,8-bits)
return strres

FUNCTION MIXSTR
PARAMETER str1, str2, seq
strmix1=alltrim(str1)
strmix2=alltrim(str2)
strres=""
strlen=len(alltrim(str1))
strkeylen=len(alltrim(str2))
strpos1=1
strpos2=1
do while strpos1<=strlen
	if strpos2=strkeylen
		strpos2=1
	endif
	strres=strres+substr(strmix1,strpos1,1)
	if mod(strpos1,seq)=0
		strres=strres+substr(strmix2,strpos2,1)
		strpos2=strpos2+1
	endif
	strpos1=strpos1+1
enddo
return alltrim(strres)

function XOR
parameter strbin
xorx=len(alltrim(strbin))
xory=1
strres=""
do while xory<=xorx
	if substr(strbin,xory,1)="0"
		strres=strres+"1"
	else
		strres=strres+"0"
	endif
	xory=xory+1
enddo
return alltrim(strres)