function encrypt
parameter input
set talk off
set echo off
strlen=len(alltrim(input))
output=alltrim(str(strlen))
for cnt=1 to strlen
	output=alltrim(output)+alltrim(str(len(alltrim(str(asc(substr(input,cnt,1))*17)))))+;
	alltrim(str(asc(substr(input,cnt,1))*17))
endfor
return output

***initial Character->length of the string
**NextCharacter->(length of Ascii value*17)
**Till Total Length




	


