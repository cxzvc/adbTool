// Samsung's reviewed private-profile marker is not an Android-wide user flag.
// Common PROFILE/type/switching rules remain in the core parser.
const SECURE_FOLDER=0x20000;
export function isSecureFolder({flags,user}={}){
  return user?.profile===true&&Number.isInteger(flags)&&flags>=0&&(flags&SECURE_FOLDER)!==0;
}
