import { ObjectId } from "mongodb";
import { AbstractEntity } from "../abstract/AbstractEntity";
import { ActivityType, IActivity } from "../interfaces/IActivity";
import { INFT, MintStatus, SaleStatus } from "../interfaces/INFT";
import { INFTBatch } from "../interfaces/INFTBatch";
import { INFTCollection, OfferStatusType } from "../interfaces/INFTCollection";
import { IPerson } from "../interfaces/IPerson";
import { IResponse } from "../interfaces/IResponse";
import { IQueryFilters } from "../interfaces/Query";
import { mailHelper } from "../util/email-helper";
import { respond } from "../util/respond";
export class ActivityController extends AbstractEntity {
  protected data: IActivity;
  protected table: string = "Activity";
  protected collectionTable: string = "NFTCollection";
  protected nftTable: string = "NFT";
  protected ownerTable: string = "Person";
  private nftBatchTable:string="NFTBatch"
  constructor(activity?: IActivity) {
    super();
    this.data = activity;
  }
  async getAllActivites(filters?: IQueryFilters,loginUser?:string): Promise<IResponse> {
    try {
      if (this.mongodb) {
        const table = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        let aggregation = {} as any;
        aggregation = this.parseFiltersFind(filters);
        let result = [] as any;
        let count;

        // const result = await table.aggregate(aggregation).toArray();
        if (aggregation && aggregation.filter) {
          aggregation.filter.push({from:loginUser})
          aggregation.filter.push({to:loginUser})
          count = await table.find({ $or: aggregation.filter }).count();
          result = aggregation.sort
            ? ((await table
                .find({ $or: aggregation.filter })
                .sort(aggregation.sort)
                .skip(aggregation.skip)
                .limit(aggregation.limit)
                .toArray()) as Array<INFT>)
            : ((await table
                .find({ $or: aggregation.filter })
                .skip(aggregation.skip)
                .limit(aggregation.limit)
                .toArray()) as Array<INFT>);
        } else {
          count = await table.find({$or:[{from:loginUser},{to:loginUser}]}).count();
          result = aggregation.sort
            ? await table.find({}).sort(aggregation.sort).skip(aggregation.skip).limit(aggregation.limit).toArray()
            : ((await table.find({}).skip(aggregation.skip).limit(aggregation.limit).toArray()) as Array<INFT>);
        }
        if (result) {
          const activities = await Promise.all(
            result.map(async (activity) => {
              const nft = (await nftTable.findOne({
                collection: activity.collection,
                index: activity.nftId,
              })) as INFT;
              // activity.nftObject = {artUri: nft.artURI, name: nft.name};
              activity.nft = { artURI: nft?.artURI, name: nft?.name };
              return activity;
            })
          );
          return respond(activities);
        }
        return respond("activity not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async transfer(collectionId: string, index: number, seller: string, buyer: string, price: number, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collTable = this.mongodb.collection(this.collectionTable);
        const personTable = this.mongodb.collection(this.ownerTable);
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        const collData = (await collTable.findOne(this.findCollectionById(collectionId))) as INFTCollection;
        let prc: number = 0;
        let vol: number = 0;
        if (collData && collData.volume) {
          typeof collData.volume == "string" ? (vol = +collData.volume) : (vol = collData.volume);
        }
        if (buyer.toLowerCase() == seller.toLowerCase()) {
          return respond("Seller and buyer cannot be same address", true, 422);
        }
        if (!price) prc = 0;
        typeof price == "string" ? (prc = +price) : (prc = price);
        if (nft) {
          if (buyer.toLowerCase() !== loginUser) {
            return respond("You are not current user of this activity ", true, 422);
          }	

          if (nft.owner !== seller) {
            return respond("from wallet isnt nft's owner.", true, 422);
          }
          if (nft.owner == buyer) {
            return respond("destination wallet is nft's owner", true, 422);
          }
          const status_date = new Date().getTime();
          const transfer: IActivity = {
            collection: collectionId,
            nftId: index,
            type: ActivityType.TRANSFER,
            date: status_date,
            from: seller,
            price: prc,
            to: buyer,
          };
          nft.saleStatus = SaleStatus.NOTFORSALE;
          nft.mintStatus = MintStatus.MINTED;
          nft.owner = buyer;
          nft.status_date = status_date;
          // nft.price=prc;
          nft.price = 0;
          collData.volume = vol + prc;
          await collTable.replaceOne(this.findCollectionById(collectionId), collData);
          await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
          await activityTable.updateMany(
            {
              collection: collectionId,
              active: true,
              from: seller,
              to: buyer,
              price: prc,
              $or: [{ type: ActivityType.LIST }, { type: ActivityType.OFFER }],
            },
            { $set: { active: false } }
          );
          const result = await activityTable.insertOne(transfer);
          /** SEND EMAIL */
          const ownerData = (await personTable.findOne({ wallet: seller.toLowerCase() })) as IPerson;
          if (ownerData && ownerData.email) {
            const email = new mailHelper();
            email.BuyNow(transfer, ownerData);
          }
          return result
            ? respond(`Successfully created a new transfer with id ${result.insertedId}`)
            : respond("Failed to create a new activity.", true, 501);
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async approveOffer(collectionId: string, index: number, seller: string, buyer: string, activityId: string, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collTable = this.mongodb.collection(this.collectionTable);
        const collData = (await collTable.findOne(this.findCollectionById(collectionId))) as INFTCollection;
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        let prc: number = 0;
        let vol: number = 0;
        if (collData && collData.volume) {
          typeof collData.volume == "string" ? (vol = +collData.volume) : (vol = collData.volume);
        }
        if (seller.toLowerCase() !== loginUser) {
          return respond("Only onwer login user can approve its own NFT item", true, 422);
        }	
        if (buyer.toLowerCase() == seller.toLowerCase()) {
          return respond("Seller and buyer cannot be same address", true, 422);
        }
        if (nft) {
          if (nft.owner.toLowerCase() !== seller.toLowerCase()) {
            return respond("seller isnt nft's owner.", true, 422);
          }
          const offer = (await activityTable.findOne(this.findActivtyWithId(activityId))) as IActivity;
          if (!offer || offer.collection !== collectionId || offer.nftId !== index) {
            return respond("Offer id is invalid", true, 422);
          }
          if (offer.to.toLowerCase() != seller.toLowerCase()) {
            return respond("seller isnt offer's seller", true, 422);
          }
          if (offer.from.toLowerCase() != buyer.toLowerCase()) {
            return respond("buyer isnt offer's buyer", true, 422);
          }
          typeof offer.price == "string" ? (prc = +offer.price) : (prc = offer.price);
          if (offer.type === ActivityType.OFFERCOLLECTION) {
            const status_date = new Date().getTime();
            nft.saleStatus = SaleStatus.NOTFORSALE;
            nft.mintStatus = MintStatus.MINTED;
            nft.owner = buyer;
            nft.price = prc;
            nft.status_date = status_date;
            collData.offerStatus = OfferStatusType.NONE;
            const saleActivity: IActivity = {
              collection: collectionId,
              nftId: index,
              type: ActivityType.SALE,
              date: status_date,
              from: seller,
              to: buyer,
              active: true,
            };
            const actData = await activityTable
              .find({ collection: collectionId, offerCollection: offer.offerCollection })
              .toArray();
            const actUpdate = await Promise.all(
              actData.map(async (item) => {
                if (item._id.toString() === offer._id.toString()) {
                  await activityTable.insertOne({
                    collection: item.collection,
                    nftId: item.nftId,
                    type: ActivityType.SALE,
                    price: prc,
                    date: new Date().getTime(),
                    from: item.from,
                    to: item.to,
                  });
                  collData.volume = vol + prc;
                  await collTable.replaceOne(this.findCollectionById(collectionId), collData);
                } else {
                  await activityTable.insertOne({
                    collection: item.collection,
                    nftId: item.nftId,
                    type: ActivityType.CANCELOFFER,
                    price: prc,
                    date: new Date().getTime(),
                    from: item.from,
                    to: item.to,
                  });
                }
                item.active = false;
                await activityTable.replaceOne(this.findActivtyWithId(item._id), item);
                return item;
              })
            );
            await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
            await activityTable.updateMany(
              {
                collection: collectionId,
                active: true,
                from: seller,
                to: buyer,
                price: prc,
                $or: [{ type: ActivityType.LIST }, { type: ActivityType.OFFERCOLLECTION }],
              },
              { $set: { active: false } }
            );
            const result = await activityTable.insertOne(saleActivity);

            const email = new mailHelper();
            email.AcceptOfferEmail(saleActivity);

            return result
              ? respond(`Successfully Approve Offer with id ${result.insertedId}`)
              : respond("Failed to create a new activity.", true, 501);
          } else if (offer.type === ActivityType.OFFER) {
            const status_date = new Date().getTime();
            nft.saleStatus = SaleStatus.NOTFORSALE;
            nft.mintStatus = MintStatus.MINTED;
            nft.owner = buyer;
            nft.status_date = status_date;
            // nft.price=prc;
            nft.price = 0;
            collData.volume = vol + prc;
            offer.active = false;
            await collTable.replaceOne(this.findCollectionById(collectionId), collData);
            await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
            await activityTable.replaceOne(this.findActivtyWithId(offer._id), offer);
            await activityTable.updateMany(
              {
                collection: collectionId,
                active: true,
                from: seller,
                to: buyer,
                price: prc,
                $or: [{ type: ActivityType.LIST }, { type: ActivityType.OFFER }],
              },
              { $set: { active: false } }
            );
            offer.type = ActivityType.SALE;
            offer.date = status_date;
            const result = await activityTable.insertOne({
              collection: offer.collection,
              nftId: offer.nftId,
              type: ActivityType.SALE,
              date: status_date,
              from: seller,
              to: buyer,
              price: prc,
              active: true,
            });

            const email = new mailHelper();
            email.AcceptOfferEmail({
              collection: offer.collection,
              nftId: offer.nftId,
              type: ActivityType.SALE,
              date: status_date,
              from: seller,
              to: buyer,
              price: prc,
              active: true,
            });

            return result
              ? respond(`Successfully created a new sold with id ${activityId}`)
              : respond("Failed to create a new activity.", true, 501);
          }
        } else {
          return respond("Item not found", true, 501);
        }
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async makeOffer(collectionId: string, index: number, seller: string, buyer: string, price: number, endDate: number, loginUser: string) {
    try {
      if (this.mongodb) {
        let prc: number = 0;
        typeof price == "string" ? (prc = +price) : (prc = price);
        if (isNaN(Number(endDate))) {
          return respond("endDate should be unix timestamp", true, 422);
        }
        if (!Number(price)) {
          return respond("Incorrect Price Value", true, 422);
        }
        if (price <= 0) {
          return respond("price cannot be negative or zero", true, 422);
        }
        if (buyer.toLowerCase() == seller.toLowerCase()) {
          return respond("Seller and buyer cannot be same address", true, 422);
        }
        const startDate = new Date().getTime();
        if (startDate > endDate) {
          return respond("start date cannot be after enddate", true, 422);
        }

        if (buyer?.toLowerCase() !== loginUser) {
          return respond("this activity not belong to the login user", true, 422);
        }        
        const activityTable = this.mongodb.collection(this.table);        
        const nftTable = this.mongodb.collection(this.nftTable);
        const collTable = this.mongodb.collection(this.collectionTable);
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        const ownTable = this.mongodb.collection(this.ownerTable);
        const sortAct = await ownTable.findOne({ wallet: buyer.toLowerCase() });
        if (nft) {


          if (nft.owner.toLowerCase() !== seller.toLowerCase()) {
            return respond("seller isnt nft's owner.", true, 422);
          }
          const nonce = sortAct && sortAct.nonce ? sortAct.nonce + 1 : 1;
          sortAct.nonce = nonce;
          await ownTable.replaceOne({ wallet: buyer.toLowerCase() }, sortAct);
          await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
          const offer: IActivity = {
            collection: collectionId,
            nftId: index,
            type: ActivityType.OFFER,
            price: prc,
            startDate: new Date().getTime(),
            endDate: endDate,
            from: buyer,
            to: seller,
            nonce,
            batchId:nft.batchId,
            active: true,
          };
          const result = await activityTable.insertOne(offer);
          if (result) {
            const findData = await activityTable.findOne({
              _id: new ObjectId(`${result.insertedId}`),
            });
            const collectionData = await collTable.findOne({
              _id: new ObjectId(findData.collection),
            });
            findData.collectionId = findData.collection;
            findData.collection = collectionData.contract;

            const email = new mailHelper();
            email.MakeOfferEmail(offer);
            return respond({
              ...findData,
            });
          } else {
            respond("Failed to create a new activity.", true, 501);
          }
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async makeCollectionOffer(collectionId: string, seller: string, buyer: string, price: number, endDate: number, loginUser: string) {
    try {
      if (this.mongodb) {
        let prc: number = 0;
        typeof price == "string" ? (prc = +price) : (prc = price);
        if (isNaN(Number(endDate))) {
          return respond("endDate should be unix timestamp", true, 422);
        }
        if (!Number(price)) {
          return respond("Incorrect Price Value", true, 422);
        }
        if (price <= 0) {
          return respond("price cannot be negative or zero", true, 422);
        }
        if (buyer.toLowerCase() == seller.toLowerCase()) {
          return respond("Seller and buyer cannot be same address", true, 422);
        }
        const startDate = new Date().getTime();
        if (startDate > endDate) {
          return respond("start date cannot be after enddate", true, 422);
        }
        if (buyer.toLowerCase() !== loginUser) {
          return respond("Login user should be the same as buyer", true, 422);
        }	
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collectionTable = this.mongodb.collection(this.collectionTable);
        const collection = (await collectionTable.findOne(this.findCollectionById(collectionId))) as INFTCollection;
        const ownTable = this.mongodb.collection(this.ownerTable);
        const nfts = (await nftTable.find({ collection: collectionId }).toArray()) as Array<INFT>;
        if (nfts && nfts.length == 0) {
          return respond("No Items", true, 501);
        }
        // const sortAct = await activityTable.findOne({}, { limit: 1, sort: { nonce: -1 } });
        const sortAct = await ownTable.findOne({ wallet: buyer.toLowerCase() });
        if (collection) {
          if (collection.creator !== seller) {
            return respond("seller isnt collection's creator.", true, 422);
          }
          const nonce = sortAct && sortAct.nonce ? sortAct.nonce + 1 : 1;
          sortAct.nonce = nonce;
          await ownTable.replaceOne({ wallet: buyer.toLowerCase() }, sortAct);
          let collId = Date.now();
          let offerTime = new Date().getTime();
          collection.offerStatus = OfferStatusType.OFFERED;
          await collectionTable.replaceOne(this.findCollectionById(collectionId), collection);
          const offer: IActivity = {
            collection: collectionId,
            type: ActivityType.OFFERCOLLECTION,
            price: price,
            startDate: offerTime,
            endDate: endDate,
            from: buyer,
            to: seller,
            nonce,
            active: true,
            offerCollection: collId,
          };
          let nftUpdate = [];
          nftUpdate = await Promise.all(
            nfts.map(async (item) => {
              // const sortAct = await ownTable.findOne({wallet:buyer.toLowerCase()});
              // const nonce = sortAct ? sortAct.nonce + 1 : 0;
              // sortAct.nonce = nonce;
              // await ownTable.replaceOne({wallet:buyer.toLowerCase()},sortAct);
              await nftTable.replaceOne(this.findNFTItem(collectionId, item.index), item);
              const collOffer: IActivity = {
                collection: collectionId,
                nftId: item.index,
                type: ActivityType.OFFERCOLLECTION,
                price: prc,
                startDate: offerTime,
                endDate: endDate,
                from: buyer,
                to: item.owner,
                nonce,
                batchId:item.batchId,
                active: true,
                offerCollection: collId,
              };
              const rOffer = await activityTable.insertOne(collOffer);
              return item;
            })
          );
          const result = await activityTable.insertOne(offer);
          if (result) {
            const findData = await activityTable.findOne({
              _id: new ObjectId(`${result.insertedId}`),
            });
            const collectionData = await collectionTable.findOne({
              _id: new ObjectId(findData.collection),
            });
            const nftData = await nftTable.find({ collection: findData.collection }).toArray();
            findData.collection = collectionData;
            findData.nfts = nftData;
            //** send email  */
            if (sortAct && sortAct.email) {
              const email = new mailHelper();
              email.CollectionOffer(offer, sortAct);
            }
            /** end of send email */
            return respond({
              ...findData,
            });
          } else {
            return respond("Failed to create a new activity.", true, 501);
          }
        }
        return respond("collection not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async listForSaleBatch(
    batchId:string,
    seller: string,
    startDate:number,
    endDate: number,
    r:string,
    s:string,
    v:string,
    loginUser?:string
  ): Promise<IResponse> {
    try {

        let error_ret=[];
        let success_rst=[];
        // let validate_data=
        const nftBatch = this.mongodb.collection(this.nftBatchTable);
        const ownTable = this.mongodb.collection(this.ownerTable);
        const result = await nftBatch.findOne({batchId:batchId}) as INFTBatch
        if (result){
          if (result && result.forSale.length>0){
            const sortAct = await ownTable.findOne({ wallet: seller.toLowerCase() });
            const nonce = sortAct && sortAct.nonce ? sortAct.nonce + 1 : 1;
            await ownTable.replaceOne({ wallet: seller.toLowerCase() }, sortAct);
            await Promise.all(
              result.forSale.map(async (item) => {
                
                const list=await this.listForSale(result.collection,item.index,seller,item.price,startDate,endDate,r,s,v,loginUser,batchId) 
                if (list && !list.success){
                  error_ret.push({
                    collectionId:result.collection,
                    nftId:item.index,
                    seller:seller,
                    price:item.price,
                    message:list.status
                  })
                }else{
                  success_rst.push(list.data)
                }
                
                
              })
            );

            result.nonce=nonce;
            result.signature= { r: r??"", s: s??"", v: v??"" };
            await nftBatch.replaceOne({batchId:batchId}, result);

            return respond({
              error:error_ret,
              success:success_rst
            });
          }else{
            return respond("batch  has not for sale items.", true, 422);
          }
         
        };

        return respond("batch Items not found.", true, 422);
        
      
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  
  /**
   * 
   * @param collectionId 
   * @param index 
   * @param seller 
   * @param price 
   * @param startDate 
   * @param endDate 
   * @param r 
   * @param s 
   * @param v 
   * @param loginUser 
   * @returns 
   */
  async listForSale(
    collectionId: string,
    index: number,
    seller: string,
    price: number,
    startDate:number,
    endDate: number,
    r:string,
    s:string,
    v:string,
    loginUser: string,
    batchId?:string
  ): Promise<IResponse> {
    try {

      if (this.mongodb) {
        if (isNaN(Number(endDate))) {
          return respond("endDate should be unix timestamp", true, 422);
        }
        if (price <= 0) {
          return respond("price cannot be negative or zero", true, 422);
        }
        // const startDate = new Date().getTime();
        if (startDate > endDate) {
          return respond("start date cannot be after enddate", true, 422);
        }
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collTable = this.mongodb.collection(this.collectionTable);
        const ownTable = this.mongodb.collection(this.ownerTable);
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        if (nft) {
          if (nft.owner.toLowerCase() !== loginUser.toLowerCase()) {
            return respond("login user isnt nft's owner.", true, 422);
          }
          if (nft.owner.toLowerCase() !== seller.toLowerCase()) {
            return respond("seller isnt nft's owner.", true, 422);
          }
          if (nft.saleStatus === SaleStatus.FORSALE) {
            return respond("Current NFT is already listed for sale.", true, 422);
          }
          // const sortAct = await activityTable.findOne({}, { limit: 1, sort: { nonce: -1 } });
          const sortAct = await ownTable.findOne({ wallet: seller.toLowerCase() });
          const status_date = new Date().getTime();
          nft.saleStatus = SaleStatus.FORSALE;
          nft.status_date = status_date;
          nft.price = price;
          const nonce = sortAct && sortAct.nonce ? sortAct.nonce + 1 : 1;
          sortAct.nonce = nonce;
          await ownTable.replaceOne({ wallet: seller.toLowerCase() }, sortAct);
          await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
          const offer: IActivity = {
            collection: collectionId,
            nftId: index,
            type: ActivityType.LIST,
            price: price,
            startDate: startDate,
            endDate: endDate,
            from: seller,
            fee: 0,
            nonce,
            signature: { r: r??"", s: s??"", v: v??"" },
            active: true,
            batchId:batchId
          };
          const result = await activityTable.insertOne(offer);
          if (result) {
            const findData = await activityTable.findOne({
              _id: new ObjectId(`${result.insertedId}`),
            });
            const collectionData = await collTable.findOne({
              _id: new ObjectId(findData.collection),
            });
            findData.collectionId = findData.collection;
            findData.collection = collectionData.contract;
            return respond({
              ...findData,
            });
          } else {
            return respond("Failed to create a new activity.", true, 501);
          }
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async cancelListForSale(collectionId: string, index: number, seller: string, activityId: string, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        if (nft) {
          if (nft.owner.toLowerCase() !== loginUser.toLowerCase()) {
            return respond("login user isnt nft's owner.", true, 422);
          }
          if (nft.owner !== seller) {
            return respond("seller isnt nft's owner.", true, 422);
          }
          if (nft.saleStatus !== SaleStatus.FORSALE) {
            return respond("Current NFT is not listed for sale.", true, 422);
          }
          const activity = (await activityTable.findOne(this.findActivtyWithId(activityId))) as IActivity;
          if (!activity) {
            return respond("activity not found.", true, 422);
          }
          if (activity.collection !== collectionId || activity.nftId !== index) {
            return respond("Invalid activity Id", true, 422);
          }
          if (activity.from !== seller) {
            return respond("seller isnt activity's owner.", true, 422);
          }
          const status_date = new Date().getTime();
          nft.saleStatus = SaleStatus.NOTFORSALE;
          nft.status_date = status_date;
          nft.price=0;
          await nftTable.replaceOne(this.findNFTItem(collectionId, index), nft);
          activity.active = false;

          await activityTable.replaceOne(this.findActivtyWithId(activityId), activity);
          const result = await activityTable.insertOne({
            collection: activity.collection,
            nftId: activity.nftId,
            type: ActivityType.CANCELLIST,
            price: activity.price,
            date: status_date,
            from: activity.from,
            fee: activity.fee,
          });
          return result ? respond("List for sale canceled") : respond("Failed to create a new activity.", true, 501);
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  
  async cancelOffer(collectionId: string, index: number, seller: string, buyer: string, activityId: string, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const nft = (await nftTable.findOne(this.findNFTItem(collectionId, index))) as INFT;
        if (buyer.toLowerCase() !== loginUser) {
          return respond("You are not current user of this activity ", true, 422);
        }	
        if (buyer.toLowerCase() == seller.toLowerCase()) {
          return respond("Seller and buyer cannot be same address", true, 422);
        }
        if (nft) {
          if (nft.owner !== seller) {
            return respond("seller isnt nft's owner.", true, 422);
          }
          const activity = (await activityTable.findOne(this.findActivtyWithId(activityId))) as IActivity;
          if (!activity) {
            return respond("activity not found.", true, 422);
          }
          if (
            activity.collection !== collectionId ||
            activity.nftId !== index ||
            activity.to != seller ||
            activity.from != buyer
          ) {
            return respond("Invalid activity Id", true, 422);
          }
          if (activity.to !== seller) {
            return respond("seller isnt activity's owner.", true, 422);
          }
          activity.active = false;
          await activityTable.replaceOne(this.findActivtyWithId(activityId), activity);
          const result = await activityTable.insertOne({
            collection: activity.collection,
            nftId: activity.nftId,
            type: ActivityType.CANCELOFFER,
            price: activity.price,
            date: new Date().getTime(),
            from: activity.from,
            to: activity.to,
          });
          const email = new mailHelper();
          email.CancelOfferEmail(activity);
          return result ? respond("Offer canceled") : respond("Failed to create a new activity.", true, 501);
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async cancelCollectionOffer(activityId: string, collectionId: string, seller: string, buyer: string, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const collectionTable = this.mongodb.collection(this.collectionTable);
        const collection = (await collectionTable.findOne(this.findCollectionById(collectionId))) as INFTCollection;
        if (collection) {
          const cancelList = (await activityTable.findOne({
            _id: new ObjectId(activityId),
            collection: collectionId,
          })) as IActivity;
          if (!cancelList) {
            return respond("activity not found.", true, 422);
          }
          if (buyer.toLowerCase() !== loginUser) {
            return respond("Login user should be the same as buyer", true, 422);
          }
          if (cancelList.from !== buyer) {
            return respond("Buyer isn't activity's owner.", true, 422);
          }
          collection.offerStatus = OfferStatusType.CANCELED;
          await collectionTable.replaceOne(this.findCollectionById(collection._id), collection);
          cancelList.type = ActivityType.CANCELOFFER;
          const result = await activityTable.replaceOne(this.findActivtyWithId(cancelList._id), cancelList);
          const actData = await activityTable.find({ offerCollection: cancelList.offerCollection }).toArray();
          const actUpdate = await Promise.all(
            actData.map(async (item) => {
              item.active = false;
              await activityTable.replaceOne(this.findActivtyWithId(item._id), item);
              await activityTable.insertOne({
                collection: item.collection,
                nftId: item.nftId,
                type: ActivityType.CANCELOFFER,
                price: item.price,
                date: new Date().getTime(),
                from: item.from,
                to: item.to,
              });
              return item;
            })
          );
          return result ? respond("Offer canceled") : respond("Failed to create a new activity.", true, 501);
        }
        return respond("nft not found.", true, 422);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async signOffer(id: string, r: string, s: string, v: string, loginUser: string) {
    try {
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const actData = (await activityTable.findOne(this.findActivtyWithId(id))) as IActivity;
        // if (actData && actData.from.toLowerCase()!==loginUser ){
        //   return respond("You are not current user of this activity ", true, 422);
        // }
        if (actData && actData.type == ActivityType.OFFERCOLLECTION && !actData.nftId) {          
          const actDataDetail = await activityTable.find({ offerCollection: actData.offerCollection }).toArray();
          const result = await Promise.all(
            actDataDetail.map(async (item) => {
              item.signature = {
                r,
                s,
                v,
              };
              await activityTable.replaceOne({ _id: new ObjectId(item._id) }, item);
              return result;
            })
          );
          // const result = await activityTable.updateMany({offerCollection:actData.offerCollection},{$set:{'signature':{r,s,v}}})
          return result ? respond("Signature updated") : respond("Failed to update activity.", true, 501);
        } else {
          actData.signature = { r, s, v };
          const result = await activityTable.replaceOne(this.findActivtyWithId(id), actData);
          return result ? respond("Signature updated") : respond("Failed to update activity.", true, 501);
        }
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  async deleteActivity(activityId: string, ownerId: String) {
    try {
      if (!ObjectId.isValid(activityId)) {
        return respond("Invalid activityId ", true, 422);
      }
      if (this.mongodb) {
        const activityTable = this.mongodb.collection(this.table);
        const nftTable = this.mongodb.collection(this.nftTable);
        const collTable = this.mongodb.collection(this.collectionTable);
        const activityData = await activityTable.findOne({ _id: new ObjectId(activityId) });
        if (!activityData) {
          return respond("Activity not found", true, 422);
        }
         
        if (activityData?.from.toLowerCase() !== ownerId) {
          return respond("this activity not belong to the login user", true, 422);
        }
        const result = await activityTable.remove({ _id: new ObjectId(activityId) });
        return result
          ? respond(`Activity with  id ${activityId} has been removed`)
          : respond("Failed to remove  activity.", true, 501);
      } else {
        throw new Error("Could not connect to the database.");
      }
    } catch (error) {
      return respond(error.message, true, 500);
    }
  }
  private findActivtyWithId(activtyId: string): Object {
    return {
      _id: new ObjectId(activtyId),
    };
  }
  private findActivityWithCollectionId(collectionId: string): Object {
    return {
      _id: new ObjectId(collectionId),
      type: ActivityType.OFFERCOLLECTION,
    };
  }
  private findActivityWithContract(contract: string): Object {
    return {
      collection: contract,
      type: ActivityType.OFFERCOLLECTION,
    };
  }
  private findCollectionById(collectionId: string): Object {
    return {
      _id: new ObjectId(collectionId),
    };
  }
  private findNFTItem(collectionId: string, index: number): Object {
    return {
      collection: collectionId,
      index,
    };
  }
}
