function boolean
parameter strVal
returnVal=.F.
strVal=alltrim(Upper(strVal))
Do Case 
	Case inlist(strVal,"TRUE","YES","1")
		returnVal=.T.
EndCase
return returnVal


