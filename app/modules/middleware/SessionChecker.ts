/**
 * Validates user session
 * @param {*} req
 * @param {*} res
 */
export const SessionChecker = async (req, res, app) => {
  if (req.raw.method === "OPTIONS") return true;

  const { authorization } = req.headers;
  let auth = null;

  try {
    let _protected = null;
    if (req.context?.schema?.properties?.protected?.method)
      _protected = req.context.schema.properties.protected;
    if (_protected) {
      if (!authorization && _protected.permission!==2) {
        res.code(401).send("Unauthorized");
        return;
      }
      if (!authorization && _protected.permission==2) {
        return;
      }
      switch (_protected.method) {
        case "jwt":
          
          auth = await jwtVerify(req, authorization, app);
          if (auth.success) {
            req.session = auth.session;
            if (
              req.params.walletId &&
              req.params.walletId.toLowerCase() !==
                auth.session.walletId.toLowerCase()
            ) {
              res.code(403).send("Forbidden");
            }
          } else {
              if (_protected.permission==2){
                return;
              }else{
                return res.code(401).send(auth)
              }
              
          };
          break;
        default:
          res.code(401).send(auth);
          return false;
      }
    }
  } catch (err) {
    res.code(401).send(err);
    throw err;
  }
};

async function jwtVerify(req, authorization, app) {
  try {
    await req.jwtVerify();
    const token = app.jwt.decode(authorization.replace("Bearer ", ""));
    const result = {
      success: true,
      session: {
        walletId: token.uid,
      },
    };
    return result;
  } catch (error) {
    return {
      success: false,
      status: error.message,
    };
  }
}
